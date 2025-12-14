// ==UserScript==
// @name         XChat Modchat Commands (textpageng)
// @namespace    xchat-modchat-commands
// @version      1.1.7
// @description  Adds /note command handling in modchat textpageng form (async save + feedback, ISO-8859-2 aware)
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

	function getNotesEditUrl(form) {
		try {
			const actionAttr = form.getAttribute('action') || '';
			const actionUrl = new URL(actionAttr, location.origin);
			const first = actionUrl.pathname.split('/').filter(Boolean)[0] || '';
			return first ? `${location.origin}/${first}/notes/edit.php` : `${location.origin}/notes/edit.php`;
		} catch {
			return `${location.origin}/notes/edit.php`;
		}
	}

	function decodeIso88592FromResponse(res) {
		return res.arrayBuffer().then((buf) => {
			// Tampermonkey runs in modern Chromium, TextDecoder supports legacy encodings.
			const decoder = new TextDecoder('iso-8859-2');
			return decoder.decode(buf);
		});
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

		const html = await decodeIso88592FromResponse(res);

		// Confirm success message in ISO-8859-2 decoded HTML
		if (!html.includes('Poznámka vložena.')) {
			return { ok: false, error: 'Nepotvrzeno serverem' };
		}

		return { ok: true };
	}

	function buildSuccessMessage(currentUserNick, savedNick) {
		return `/m ${currentUserNick} Uživatel ${savedNick} uložen do Poznámek`;
	}

	function buildMissingNickMessage(currentUserNick) {
		return `/m ${currentUserNick} Nelze uložit poznámku: Chybí nick`;
	}

	function buildErrorMessage(currentUserNick, savedNick, error) {
		const target = savedNick ? `pro uživatele ${savedNick}` : '';
		const suffix = target ? ` ${target}` : '';
		return `/m ${currentUserNick} Chyba při ukládání poznámky${suffix}: ${error}`;
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
			if (!parsed || parsed.cmd !== 'note') return;

			const args = parseNoteArgs(parsed.argsText);

			e.preventDefault();
			e.stopImmediatePropagation();

			(async () => {
				if (!args.nick) {
					msg.value = buildMissingNickMessage(currentUserNick);
					nativeSubmit(form);
					return;
				}

				const result = await saveNote(form, args.nick, args.description);

				if (result.ok) {
					msg.value = buildSuccessMessage(currentUserNick, args.nick);
				} else {
					msg.value = buildErrorMessage(currentUserNick, args.nick, result.error || 'Unknown error');
				}

				nativeSubmit(form);
			})().catch((err) => {
				msg.value = buildErrorMessage(currentUserNick, args.nick || '', `Unhandled error: ${String(err)}`);
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
