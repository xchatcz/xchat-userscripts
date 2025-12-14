// ==UserScript==
// @name         XChat Modchat Commands (textpageng)
// @namespace    xchat-modchat-commands
// @version      1.2.0
// @description  Adds /note and /unnote command handling in modchat textpageng form (async save/delete + feedback, ISO-8859-2 aware)
// @match        https://www.xchat.cz/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
	'use strict';

	function isTargetPage() {
		try {
			const url = new URL(location.href);
			return url.pathname.endsWith('/modchat') && url.searchParams.get('op') === 'textpageng';
		} catch {
			return false;
		}
	}

	function getNickFromForm(form) {
		const strong = form.querySelector('strong');
		if (!strong) return '';
		return (strong.textContent || '').replace(/:\s*$/, '').trim();
	}

	function parseCommand(text) {
		const t = (text || '').trim();
		if (!t.startsWith('/')) return null;

		const m = t.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
		if (!m) return null;

		return { cmd: (m[1] || '').toLowerCase(), argsText: (m[2] || '').trim() };
	}

	function parseNoteArgs(argsText) {
		// /note <nick> [description...]
		const raw = (argsText || '').trim();
		if (!raw) return { nick: '', description: '' };

		const m = raw.match(/^(\S+)(?:\s+([\s\S]+))?$/);
		if (!m) return { nick: '', description: '' };

		const nick = (m[1] || '').trim();
		const description = (m[2] || '').trim(); // optional
		return { nick, description };
	}

	function parseUnnoteArgs(argsText) {
		// /unnote <nick>
		const raw = (argsText || '').trim();
		if (!raw) return { nick: '' };

		const m = raw.match(/^(\S+)/);
		if (!m) return { nick: '' };

		return { nick: (m[1] || '').trim() };
	}

	function getPrefixFromForm(form) {
		// form action: "/~$.../modchat" => prefix "~$..."
		try {
			const actionAttr = form.getAttribute('action') || '';
			const actionUrl = new URL(actionAttr, location.origin);
			return actionUrl.pathname.split('/').filter(Boolean)[0] || '';
		} catch {
			return '';
		}
	}

	function getNotesEditUrl(form) {
		const prefix = getPrefixFromForm(form);
		return prefix ? `${location.origin}/${prefix}/notes/edit.php` : `${location.origin}/notes/edit.php`;
	}

	function getNotesListBaseUrl(form) {
		const prefix = getPrefixFromForm(form);
		return prefix ? `${location.origin}/${prefix}/notes/` : `${location.origin}/notes/`;
	}

	async function decodeIso88592(res) {
		const buf = await res.arrayBuffer();
		const decoder = new TextDecoder('iso-8859-2');
		return decoder.decode(buf);
	}

	function parseHtml(html) {
		return new DOMParser().parseFromString(html, 'text/html');
	}

	async function saveNote(form, nick, description) {
		const url = getNotesEditUrl(form);

		const body = new URLSearchParams();
		body.set('pop', '');
		body.set('page', '1');
		body.set('n_about', nick);
		body.set('n_comment', description || '');
		body.set('n_enter', 'on');
		body.set('btn_change', 'Uložit');

		let res;
		try {
			res = await fetch(url, {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				},
				body: body.toString(),
				credentials: 'include',
			});
		} catch (err) {
			return { ok: false, error: `Network error: ${String(err && err.message ? err.message : err)}` };
		}

		if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

		const html = await decodeIso88592(res);
		if (!html.includes('Poznámka vložena.')) {
			return { ok: false, error: 'Nepotvrzeno serverem' };
		}

		return { ok: true };
	}

	function extractMaxPageFromNotesDoc(doc) {
		let maxPage = 1;
		const links = doc.querySelectorAll('#mn a[href*="page="]');
		for (const a of links) {
			const href = a.getAttribute('href') || '';
			const m = href.match(/[?&]page=(\d+)/);
			if (m) {
				const n = parseInt(m[1], 10);
				if (!Number.isNaN(n) && n > maxPage) maxPage = n;
			}
		}
		return maxPage;
	}

	function findDeleteHrefForNick(doc, nick) {
		// Find "edit.php?n_about=<nick>" and then the "smazat" link in the same row/container
		const escaped = CSS.escape(nick);
		const editLink = doc.querySelector(`a[href*="edit.php"][href*="n_about=${encodeURIComponent(nick)}"], a[href*="edit.php"][href*="n_about=${escaped}"]`);

		// Fallback: match by visible nick in profile link text
		let anchor = editLink;
		if (!anchor) {
			const profileLinks = doc.querySelectorAll('a');
			for (const a of profileLinks) {
				if ((a.textContent || '').trim() === nick) {
					anchor = a;
					break;
				}
			}
		}

		if (!anchor) return '';

		const row = anchor.closest('.notesl') || anchor.closest('div');
		if (!row) return '';

		const del = row.querySelector('a[href*="del="]');
		return del ? (del.getAttribute('href') || '') : '';
	}

	function notesDocContainsNick(doc, nick) {
		const links = doc.querySelectorAll('#mn a');
		for (const a of links) {
			if ((a.textContent || '').trim() === nick) return true;
		}
		return false;
	}

	async function unnote(form, nick) {
		const baseUrl = getNotesListBaseUrl(form);

		const fetchPage = async (page) => {
			const url = new URL(baseUrl);
			url.searchParams.set('page', String(page));

			let res;
			try {
				res = await fetch(url.toString(), {
					method: 'GET',
					headers: { 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
					credentials: 'include',
				});
			} catch (err) {
				return { ok: false, error: `Network error: ${String(err && err.message ? err.message : err)}` };
			}

			if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

			const html = await decodeIso88592(res);
			return { ok: true, url: url.toString(), doc: parseHtml(html), html };
		};

		// Load first page to get pagination range
		const first = await fetchPage(1);
		if (!first.ok) return first;

		const maxPage = extractMaxPageFromNotesDoc(first.doc);

		let deleteHref = findDeleteHrefForNick(first.doc, nick);
		let deletePageUrl = first.url;

		if (!deleteHref && maxPage > 1) {
			for (let p = 2; p <= maxPage; p++) {
				const pageRes = await fetchPage(p);
				if (!pageRes.ok) return pageRes;

				deleteHref = findDeleteHrefForNick(pageRes.doc, nick);
				if (deleteHref) {
					deletePageUrl = pageRes.url;
					break;
				}
			}
		}

		if (!deleteHref) {
			return { ok: false, error: 'Nick nebyl v Poznámkách nalezen' };
		}

		const deleteUrl = new URL(deleteHref, deletePageUrl).toString();

		let delRes;
		try {
			delRes = await fetch(deleteUrl, {
				method: 'GET',
				headers: { 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
				credentials: 'include',
			});
		} catch (err) {
			return { ok: false, error: `Network error: ${String(err && err.message ? err.message : err)}` };
		}

		if (!delRes.ok) return { ok: false, error: `HTTP ${delRes.status}` };

		// Try to confirm by checking the returned page doesn't contain the nick anymore
		const delHtml = await decodeIso88592(delRes);
		const delDoc = parseHtml(delHtml);

		if (notesDocContainsNick(delDoc, nick)) {
			// Could be on different page after deletion; do one refetch of the page we deleted from
			const refetch = await fetch(deletePageUrl, {
				method: 'GET',
				headers: { 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
				credentials: 'include',
			}).then(async (r) => {
				if (!r.ok) return null;
				const h = await decodeIso88592(r);
				return parseHtml(h);
			}).catch(() => null);

			if (refetch && notesDocContainsNick(refetch, nick)) {
				return { ok: false, error: 'Smazání se nepotvrdilo' };
			}
		}

		return { ok: true };
	}

	function buildSuccessNoteMessage(currentUserNick, savedNick) {
		return `/m ${currentUserNick} Uživatel ${savedNick} uložen do Poznámek`;
	}

	function buildSuccessUnnoteMessage(currentUserNick, removedNick) {
		return `/m ${currentUserNick} Uživatel ${removedNick} odebrán z Poznámek`;
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

	function nativeSubmit(form) {
		HTMLFormElement.prototype.submit.call(form);
	}

	function hookForm(form) {
		if (form.dataset.xstatNoteHooked === '1') return;
		form.dataset.xstatNoteHooked = '1';

		const msg = form.querySelector('#msg');
		if (!msg) return;

		const currentUserNick = getNickFromForm(form);

		form.addEventListener('submit', (e) => {
			const original = msg.value || '';
			const parsed = parseCommand(original);
			if (!parsed) return;

			if (parsed.cmd !== 'note' && parsed.cmd !== 'unnote') return;

			e.preventDefault();
			e.stopImmediatePropagation();

			(async () => {
				if (parsed.cmd === 'note') {
					const args = parseNoteArgs(parsed.argsText);

					if (!args.nick) {
						msg.value = buildMissingNickNoteMessage(currentUserNick);
						nativeSubmit(form);
						return;
					}

					const result = await saveNote(form, args.nick, args.description);

					msg.value = result.ok
						? buildSuccessNoteMessage(currentUserNick, args.nick)
						: buildErrorMessage(currentUserNick, 'ukládání poznámky', args.nick, result.error || 'Unknown error');

					nativeSubmit(form);
					return;
				}

				// unnote
				const args = parseUnnoteArgs(parsed.argsText);

				if (!args.nick) {
					msg.value = buildMissingNickUnnoteMessage(currentUserNick);
					nativeSubmit(form);
					return;
				}

				const result = await unnote(form, args.nick);

				msg.value = result.ok
					? buildSuccessUnnoteMessage(currentUserNick, args.nick)
					: buildErrorMessage(currentUserNick, 'odebírání poznámky', args.nick, result.error || 'Unknown error');

				nativeSubmit(form);
			})().catch((err) => {
				msg.value = buildErrorMessage(currentUserNick, 'zpracování příkazu', '', `Unhandled error: ${String(err)}`);
				nativeSubmit(form);
			});
		}, true);
	}

	function findAndHook() {
		if (!isTargetPage()) return;
		const form = document.querySelector('form[name="f"][action*="/modchat"]');
		if (form) hookForm(form);
	}

	findAndHook();

	const mo = new MutationObserver(() => findAndHook());
	mo.observe(document.documentElement, { childList: true, subtree: true });
})();
