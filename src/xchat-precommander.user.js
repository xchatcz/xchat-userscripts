// ==UserScript==
// @name         XChat Modchat Commands
// @namespace    xchat-modchat-commands
// @version      1.3.3
// @match        https://www.xchat.cz/*/modchat*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
	'use strict';

	const msg = document.getElementById('msg');
	if (!msg) {
		return;
	}

	const form = document.querySelector('form[name="f"]');
	if (!form) return;

	// Must be the text input page (works for both GET ?op=textpageng and POST without query)
	const opField = form.querySelector('input[name="op"]');
	if (!opField || (opField.value || '').toLowerCase() !== 'textpageng') return;

	function getCurrentUserNick() {
		const strong = form.querySelector('strong');
		return strong ? strong.textContent.replace(/:\s*$/, '').trim() : '';
	}

	function parseCommand(text) {
		const t = (text || '').trim();
		if (!t.startsWith('/')) return null;

		const m = t.match(/^\/(\S+)(?:\s+(.*))?$/);
		if (!m) return null;

		return {
			cmd: (m[1] || '').toLowerCase(),
			args: (m[2] || '').trim(),
		};
	}

	function nativeSubmit() {
		HTMLFormElement.prototype.submit.call(form);
	}

	function getPrefixFromForm() {
		try {
			const action = new URL(form.action, location.origin);
			return action.pathname.split('/').filter(Boolean)[0] || '';
		} catch {
			return '';
		}
	}

	async function decodeIso88592(res) {
		const buf = await res.arrayBuffer();
		return new TextDecoder('iso-8859-2').decode(buf);
	}

	async function saveNote(targetNick, description) {
		const prefix = getPrefixFromForm();
		const urlEdit = `${location.origin}/${prefix}/notes/edit.php`;

		const body = new URLSearchParams({
			pop: '',
			page: '1',
			n_about: targetNick,
			n_comment: description || '',
			n_enter: 'on',
			btn_change: 'Uložit',
		});

		let res;
		try {
			res = await fetch(urlEdit, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: body.toString(),
				credentials: 'include',
			});
		} catch (err) {
			return { ok: false, error: `Network error: ${String(err && err.message ? err.message : err)}` };
		}

		if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

		const html = await decodeIso88592(res);
		const ok = html.includes('Poznámka vložena.');
		return ok ? { ok: true } : { ok: false, error: 'Nepotvrzeno serverem' };
	}

	function extractMaxPage(doc) {
		let max = 1;
		const links = doc.querySelectorAll('#mn a[href*="page="]');
		for (const a of links) {
			const href = a.getAttribute('href') || '';
			const m = href.match(/[?&]page=(\d+)/);
			if (m) {
				const n = parseInt(m[1], 10);
				if (!Number.isNaN(n) && n > max) max = n;
			}
		}
		return max;
	}

	function findDeleteHrefForNick(doc, nick) {
		const nickAnchor = [...doc.querySelectorAll('#mn a')].find((a) => (a.textContent || '').trim() === nick);
		if (!nickAnchor) return '';

		const row = nickAnchor.closest('.notesl');
		if (!row) return '';

		const del = row.querySelector('a[href*="del="]');
		return del ? (del.getAttribute('href') || '') : '';
	}

	function notesDocContainsNick(doc, nick) {
		return [...doc.querySelectorAll('#mn a')].some((a) => (a.textContent || '').trim() === nick);
	}

	async function removeNote(targetNick) {
		const prefix = getPrefixFromForm();
		const baseUrl = `${location.origin}/${prefix}/notes/`;

		const fetchPage = async (page) => {
			let res;
			try {
				res = await fetch(`${baseUrl}?page=${page}`, { credentials: 'include' });
			} catch (err) {
				return { ok: false, error: `Network error: ${String(err && err.message ? err.message : err)}` };
			}
			if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

			const html = await decodeIso88592(res);
			const doc = new DOMParser().parseFromString(html, 'text/html');
			return { ok: true, doc };
		};

		const first = await fetchPage(1);
		if (!first.ok) return first;

		const maxPage = extractMaxPage(first.doc);

		let deleteHref = findDeleteHrefForNick(first.doc, targetNick);
		let foundOnPage = 1;

		if (!deleteHref && maxPage > 1) {
			for (let p = 2; p <= maxPage; p++) {
				const pageRes = await fetchPage(p);
				if (!pageRes.ok) return pageRes;

				deleteHref = findDeleteHrefForNick(pageRes.doc, targetNick);
				if (deleteHref) {
					foundOnPage = p;
					break;
				}
			}
		}

		if (!deleteHref) return { ok: false, error: 'Nick nebyl v Poznámkách nalezen' };

		const deleteUrl = new URL(deleteHref, `${baseUrl}?page=${foundOnPage}`).toString();

		let delRes;
		try {
			delRes = await fetch(deleteUrl, { credentials: 'include' });
		} catch (err) {
			return { ok: false, error: `Network error: ${String(err && err.message ? err.message : err)}` };
		}

		if (!delRes.ok) return { ok: false, error: `HTTP ${delRes.status}` };

		const delHtml = await decodeIso88592(delRes);
		const delDoc = new DOMParser().parseFromString(delHtml, 'text/html');

		if (notesDocContainsNick(delDoc, targetNick)) {
			const check = await fetchPage(foundOnPage);
			if (check.ok && notesDocContainsNick(check.doc, targetNick)) {
				return { ok: false, error: 'Smazání se nepotvrdilo' };
			}
		}

		return { ok: true };
	}

	function buildMissingNickNoteMessage(currentUserNick) {
		return `/m ${currentUserNick} Nelze uložit poznámku: Chybí nick`;
	}

	function buildMissingNickUnnoteMessage(currentUserNick) {
		return `/m ${currentUserNick} Nelze odebrat poznámku: Chybí nick`;
	}

	function buildErrorMessage(currentUserNick, actionLabel, targetNick, error) {
		const target = targetNick ? ` pro uživatele ${targetNick}` : '';
		return `/m ${currentUserNick} Chyba při ${actionLabel}${target}: ${error}`;
	}

	function buildSuccessNoteMessage(currentUserNick, savedNick) {
		return `/m ${currentUserNick} Uživatel ${savedNick} uložen do Poznámek`;
	}

	function buildSuccessUnnoteMessage(currentUserNick, removedNick) {
		return `/m ${currentUserNick} Uživatel ${removedNick} odebrán z Poznámek`;
	}

	// Idempotent hook for this document instance
	if (form.dataset.xstatNoteHooked === '1') return;
	form.dataset.xstatNoteHooked = '1';

	const userNick = getCurrentUserNick();

	form.addEventListener('submit', (e) => {
		const parsed = parseCommand(msg.value);
		if (!parsed) return;
		if (parsed.cmd !== 'note' && parsed.cmd !== 'unnote') return;

		e.preventDefault();
		e.stopImmediatePropagation();

		(async () => {
			if (parsed.cmd === 'note') {
				const raw = parsed.args || '';
				const m = raw.match(/^(\S+)(?:\s+([\s\S]+))?$/);

				const targetNick = m ? (m[1] || '').trim() : '';
				const description = m ? (m[2] || '').trim() : '';

				if (!targetNick) {
					msg.value = buildMissingNickNoteMessage(userNick);
					nativeSubmit();
					return;
				}

				const result = await saveNote(targetNick, description);

				msg.value = result.ok
					? buildSuccessNoteMessage(userNick, targetNick)
					: buildErrorMessage(userNick, 'ukládání poznámky', targetNick, result.error || 'Unknown error');

				nativeSubmit();
				return;
			}

			// unnote
			const targetNick = (parsed.args || '').trim();
			if (!targetNick) {
				msg.value = buildMissingNickUnnoteMessage(userNick);
				nativeSubmit();
				return;
			}

			const result = await removeNote(targetNick);

			msg.value = result.ok
				? buildSuccessUnnoteMessage(userNick, targetNick)
				: buildErrorMessage(userNick, 'odebírání poznámky', targetNick, result.error || 'Unknown error');

			nativeSubmit();
		})().catch((err) => {
			msg.value = buildErrorMessage(userNick, 'zpracování příkazu', '', `Unhandled error: ${String(err)}`);
			nativeSubmit();
		});
	}, true);

})();
