// ==UserScript==
// @name         XChat Modchat Commands
// @namespace    xchat-modchat-commands
// @version      1.4.0
// @match        https://www.xchat.cz/*/modchat?op=textpageng*
// @match        https://www.xchat.cz/*/modchat
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
	'use strict';

	/* ---------------- config ---------------- */

	const REPORT_NICK = 'Elza'; // all responses must be: "/m Elza ..."

	/* ---------------- helpers: boot / rehook ---------------- */

	function getMsgField() {
		return document.getElementById('msg');
	}

	function getForm() {
		return document.querySelector('form[name="f"]');
	}

	function isTextPage(form) {
		if (!form) return false;
		const opField = form.querySelector('input[name="op"]');
		if (!opField) return false;
		return String(opField.value || '').toLowerCase() === 'textpageng';
	}

	function nativeSubmit(form) {
		HTMLFormElement.prototype.submit.call(form);
	}

	function getCurrentUserNick(form) {
		const strong = form ? form.querySelector('strong') : null;
		const nick = strong ? String(strong.textContent || '').replace(/:\s*$/, '').trim() : '';
		return nick;
	}

	function getRidFromForm(form) {
		const ridField = form ? form.querySelector('input[name="rid"]') : null;
		const ridStr = ridField ? String(ridField.value || '').trim() : '';
		const rid = parseInt(ridStr, 10);
		return Number.isFinite(rid) && rid > 0 ? rid : 0;
	}

	function getPrefixFromForm(form) {
		// action: "/~$...~hash/modchat"
		try {
			const action = new URL(form.action, location.origin);
			return action.pathname.split('/').filter(Boolean)[0] || '';
		} catch {
			return '';
		}
	}

	function parseCommand(text) {
		const t = String(text || '').trim();
		if (!t.startsWith('/')) return null;

		const m = t.match(/^\/(\S+)(?:\s+([\s\S]+))?$/);
		if (!m) return null;

		return {
			cmd: String(m[1] || '').toLowerCase(),
			args: String(m[2] || '').trim(),
		};
	}

	function buildPm(message) {
		return `/m ${REPORT_NICK} ${message}`;
	}

	async function decodeIso88592(res) {
		const buf = await res.arrayBuffer();
		return new TextDecoder('iso-8859-2').decode(buf);
	}

	function parseHtml(html) {
		return new DOMParser().parseFromString(String(html || ''), 'text/html');
	}

	/* ---------------- notes: save / remove (kept as you provided) ---------------- */

	async function saveNote(prefix, targetNick, description) {
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

	async function removeNote(prefix, targetNick) {
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

	/* ---------------- admin HTTP helpers (no custom encoding added) ---------------- */

	async function httpGetIso(url) {
		let res;
		try {
			res = await fetch(url, { credentials: 'include' });
		} catch (err) {
			return { ok: false, status: 0, body: '', error: `Network error: ${String(err && err.message ? err.message : err)}` };
		}
		if (!res.ok) return { ok: false, status: res.status, body: '', error: `HTTP ${res.status}` };

		const body = await decodeIso88592(res);
		return { ok: true, status: res.status, body, error: '' };
	}

	async function httpPostFormIsoRead(url, fields) {
		const body = new URLSearchParams(fields || {}).toString();

		let res;
		try {
			res = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body,
				credentials: 'include',
			});
		} catch (err) {
			return { ok: false, status: 0, body: '', error: `Network error: ${String(err && err.message ? err.message : err)}` };
		}
		if (!res.ok) return { ok: false, status: res.status, body: '', error: `HTTP ${res.status}` };

		const html = await decodeIso88592(res);
		return { ok: true, status: res.status, body: html, error: '' };
	}

	/* ---------------- XChat admin logic (ported) ---------------- */

	async function getUidByNick(prefix, rid, nick) {
		const url = `${location.origin}/${prefix}/admin/ak_ext/?sent=0&id_room=${encodeURIComponent(String(rid))}`;

		// Server expects ISO in PHP version; we keep original JS behavior (no custom encoding).
		const post = {
			nick: String(nick || ''),
			id_room: String(rid || ''),
			sent: '1',
		};

		const res = await httpPostFormIsoRead(url, post);
		if (!res.ok) return null;

		const doc = parseHtml(res.body);

		// Find row: <tr><td><strong>Nick:</strong></td><td>Nick (12345)</td>...
		const rows = [...doc.querySelectorAll('tr')];
		for (const tr of rows) {
			const strong = tr.querySelector('td strong');
			if (!strong) continue;
			if (String(strong.textContent || '').trim() !== 'Nick:') continue;

			const tds = tr.querySelectorAll('td');
			if (!tds || tds.length < 2) continue;

			const cellText = String(tds[1].textContent || '').replace(/\s+/g, ' ').trim();
			const nickFromPage = cellText.replace(/\s*\(.+\)\s*$/u, '').trim();
			if (nickFromPage !== String(nick || '').trim()) return null;

			const m = cellText.match(/\((\d{4,})\)/);
			if (!m) return null;

			const uid = parseInt(m[1], 10);
			return Number.isFinite(uid) ? uid : null;
		}

		return null;
	}

	async function fetchIpAndDomainByNick(prefix, rid, nick) {
		const uid = await getUidByNick(prefix, rid, nick);
		if (!uid) return { ok: false, error: 'Nepodařilo se zjistit UID' };

		const url = `${location.origin}/${prefix}/admin/ip_block_extended/block-index.phtml?uid=${encodeURIComponent(String(uid))}`;
		const res = await httpGetIso(url);
		if (!res.ok) return { ok: false, error: res.error || 'HTTP chyba' };

		const doc = parseHtml(res.body);

		function getAfterStrong(label) {
			const strongs = [...doc.querySelectorAll('strong')];
			const s = strongs.find((x) => String(x.textContent || '').trim() === label);
			if (!s) return '';
			// text node after <strong>Label</strong> : value
			let txt = '';
			for (const node of s.parentNode.childNodes) {
				if (node === s) continue;
				if (node.nodeType === Node.TEXT_NODE) txt += node.nodeValue || '';
			}
			txt = txt.replace(/\u00A0/g, ' ');
			txt = txt.replace(/^\s*:\s*/u, '').trim().replace(/\s+/g, ' ');
			return txt;
		}

		const ip = getAfterStrong('IP');
		const domain = getAfterStrong('Domain');

		if (!ip && !domain) return { ok: false, error: 'IP/Domain na stránce nebyly nalezeny' };

		return { ok: true, ip: ip || '', domain: domain || '' };
	}

	function addYears(date, years) {
		const d = new Date(date.getTime());
		d.setFullYear(d.getFullYear() + years);
		return d;
	}

	function dateParts(dt) {
		// local time (Prague)
		return {
			day: String(dt.getDate()).padStart(2, '0'),
			month: String(dt.getMonth() + 1).padStart(2, '0'),
			year: String(dt.getFullYear()),
			hour: String(dt.getHours()).padStart(2, '0'),
			minute: String(dt.getMinutes()).padStart(2, '0'),
		};
	}

	async function fetchBlacklistIds(prefix, uid, history) {
		// history: -1 only active, 1 history
		const baseUrl = `${location.origin}/${prefix}/admin/blacklist/black-index.phtml`;

		const ids = [];
		let offset = 0;

		for (let i = 0; i < 200; i++) {
			const post = {
				filter_history: String(history === 1 ? 1 : -1),
				uid: String(uid),
				orderBy: 'blacklist.date_to',
				recordOffset: String(offset),
				_Submit: '1',
			};

			const res = await httpPostFormIsoRead(baseUrl, post);
			if (!res.ok) break;

			const doc = parseHtml(res.body);

			const links = [...doc.querySelectorAll("tr.OddRow td a[href*='edit.phtml'], tr.EvenRow td a[href*='edit.phtml']")];
			for (const a of links) {
				const href = a.getAttribute('href') || '';
				const m = href.match(/[?&]id=(\d+)/);
				if (m) ids.push(parseInt(m[1], 10));
			}

			const next = [...doc.querySelectorAll("a[href*='black-index.phtml']")].find((a) => String(a.textContent || '').includes('Next page'));
			if (!next) break;

			const hrefNext = next.getAttribute('href') || '';
			const mm = hrefNext.match(/[?&]recordOffset=(\d+)/);
			if (!mm) break;

			const newOff = parseInt(mm[1], 10);
			if (!Number.isFinite(newOff) || newOff <= offset) break;

			offset = newOff;
		}

		const uniq = [...new Set(ids.filter((x) => Number.isFinite(x)))].sort((a, b) => b - a);
		return uniq;
	}

	async function deleteBlacklist(prefix, id, uid) {
		const qs = new URLSearchParams({
			id: String(id),
			uid: String(uid),
			filter_history: '1',
			orderBy: 'blacklist.date_to',
		}).toString();

		const url = `${location.origin}/${prefix}/admin/blacklist/delete.phtml?${qs}`;
		const res = await httpGetIso(url);
		return res.ok;
	}

	async function saveBlacklistDetails(prefix, rid, targetNick, description, adminNick) {
		const uid = await getUidByNick(prefix, rid, targetNick);
		if (!uid) return { ok: false, error: 'Nepodařilo se zjistit UID uživatele' };

		const adminUid = await getUidByNick(prefix, rid, adminNick);
		if (!adminUid) return { ok: false, error: 'Nepodařilo se zjistit UID admina' };

		const now = new Date();
		const to = addYears(now, 1);

		const f = dateParts(now);
		const t = dateParts(to);

		const url = `${location.origin}/${prefix}/admin/blacklist/edit.phtml?uid=${encodeURIComponent(String(uid))}`;

		const post = {
			date_from_XDAY: f.day,
			date_from_XMONTH: f.month,
			date_from_XYEAR: f.year,
			date_from_HOUR: f.hour,
			date_from_MINUTE: f.minute,

			date_to_XDAY: t.day,
			date_to_XMONTH: t.month,
			date_to_XYEAR: t.year,
			date_to_HOUR: t.hour,
			date_to_MINUTE: t.minute,

			description: String(description || ''),
			user_description: 'Založení nového účtu za účelem obcházení blokace na jiném účtu',

			uid: String(uid),

			adminnick: String(adminNick || '').toLowerCase(),
			admin: String(adminUid),

			isNewRecord: '1',
			_Submit: 'Uložit',

			// sanctions
			sanction_8: 'on',
		};

		const res = await httpPostFormIsoRead(url, post);
		if (!res.ok) return { ok: false, error: res.error || 'HTTP chyba' };

		return { ok: true };
	}

	async function clearText(prefix, targetNick) {
		const url = `${location.origin}/${prefix}/admin/blacklist/cleartext.php`;

		const post = {
			nick: String(targetNick || ''),
			Button_Block: 'Smazat',
		};

		const res = await httpPostFormIsoRead(url, post);
		if (!res.ok) return { ok: null, error: res.error || 'HTTP chyba' };

		const body = String(res.body || '');
		const ok =
			body.includes('Texty byly smazány') ||
			body.includes('200 OK, User texts cleared');

		return { ok: ok ? true : false, error: ok ? '' : 'Nepotvrzeno serverem' };
	}

	/* ---------------- command handlers ---------------- */

	async function handleNote(prefix, args) {
		const raw = String(args || '');
		const m = raw.match(/^(\S+)(?:\s+([\s\S]+))?$/);

		const targetNick = m ? String(m[1] || '').trim() : '';
		const description = m ? String(m[2] || '').trim() : ''; // optional

		if (!targetNick) return { ok: true, message: buildPm('Nelze uložit poznámku: Chybí nick') };

		const result = await saveNote(prefix, targetNick, description);
		if (result.ok) return { ok: true, message: buildPm(`Uživatel ${targetNick} uložen do Poznámek`) };

		return { ok: true, message: buildPm(`Chyba při ukládání poznámky pro uživatele ${targetNick}: ${result.error || 'Unknown error'}`) };
	}

	async function handleUnnote(prefix, args) {
		const targetNick = String(args || '').trim();
		if (!targetNick) return { ok: true, message: buildPm('Nelze odebrat poznámku: Chybí nick') };

		const result = await removeNote(prefix, targetNick);
		if (result.ok) return { ok: true, message: buildPm(`Uživatel ${targetNick} odebrán z Poznámek`) };

		return { ok: true, message: buildPm(`Chyba při odebírání poznámky pro uživatele ${targetNick}: ${result.error || 'Unknown error'}`) };
	}

	async function handleShowIp(prefix, rid, args) {
		const targetNick = String(args || '').trim();
		if (!targetNick) return { ok: true, message: buildPm('Chybí nick') };

		const res = await fetchIpAndDomainByNick(prefix, rid, targetNick);
		if (!res.ok) return { ok: true, message: buildPm(`IP uživatele ${targetNick} se nepodařilo zjistit: ${res.error || 'Unknown error'}`) };

		const ip = res.ip || '';
		const domain = res.domain || '';
		return { ok: true, message: buildPm(`IP/Domain pro ${targetNick}: IP=${ip || '-'} Domain=${domain || '-'}`) };
	}

	async function handleBan(prefix, rid, myNick, args) {
		const raw = String(args || '');
		const m = raw.match(/^(\S+)(?:\s+([\s\S]+))?$/);

		const targetNick = m ? String(m[1] || '').trim() : '';
		const description = m ? String(m[2] || '').trim() : '';

		if (!targetNick) return { ok: true, message: buildPm('Chybí nick') };
		if (!description) return { ok: true, message: buildPm(`Chybí popis blokace pro ${targetNick}`) };
		if (!myNick) return { ok: true, message: buildPm('Nepodařilo se zjistit tvůj nick (adminnick)') };

		const res = await saveBlacklistDetails(prefix, rid, targetNick, description, myNick);
		if (!res.ok) return { ok: true, message: buildPm(`Chyba při blokování uživatele ${targetNick}: ${res.error || 'Unknown error'}`) };

		return { ok: true, message: buildPm(`Uživatel ${targetNick} byl zablokován`) };
	}

	async function handleUnban(prefix, rid, args) {
		const targetNick = String(args || '').trim();
		if (!targetNick) return { ok: true, message: buildPm('Chybí nick') };

		const uid = await getUidByNick(prefix, rid, targetNick);
		if (!uid) return { ok: true, message: buildPm(`Nepodařilo se zjistit UID uživatele ${targetNick}`) };

		const activeIds = await fetchBlacklistIds(prefix, uid, -1);
		const ids = Array.isArray(activeIds) ? [...new Set(activeIds.map((x) => parseInt(String(x), 10)).filter((x) => Number.isFinite(x)))] : [];

		if (!ids.length) return { ok: true, message: buildPm(`Uživatel ${targetNick} nemá aktivní blokaci`) };

		let deleted = 0;
		for (const bid of ids) {
			const ok = await deleteBlacklist(prefix, bid, uid);
			if (ok) deleted++;
		}

		if (deleted > 0) return { ok: true, message: buildPm(`Uživatel ${targetNick} byl odblokován`) };

		return { ok: true, message: buildPm(`Uživatele ${targetNick} se nepodařilo odblokovat`) };
	}

	async function handleClearNick(prefix, args) {
		const targetNick = String(args || '').trim();
		if (!targetNick) return { ok: true, message: buildPm('Chybí nick') };

		const res = await clearText(prefix, targetNick);
		if (res.ok === null) return { ok: true, message: buildPm(`Chyba při mazání textů pro ${targetNick}: ${res.error || 'HTTP chyba'}`) };
		if (res.ok === false) return { ok: true, message: buildPm(`Mazání textů pro ${targetNick} se nepotvrdilo`) };

		return { ok: true, message: buildPm(`Texty uživatele ${targetNick} byly smazány`) };
	}

	/* ---------------- main hook ---------------- */

	function tryHookOnce() {
		const msg = getMsgField();
		if (!msg) return false;

		const form = getForm();
		if (!form) return false;

		if (!isTextPage(form)) return false;

		// idempotent per document instance
		if (form.dataset.xstatEnhancerHooked === '1') return true;
		form.dataset.xstatEnhancerHooked = '1';

		const prefix = getPrefixFromForm(form);
		const rid = getRidFromForm(form);
		const myNick = getCurrentUserNick(form);

		form.addEventListener('submit', (e) => {
			const parsed = parseCommand(msg.value);
			if (!parsed) return;

			// Only intercept known commands.
			const known = new Set(['note', 'unnote', 'showip', 'ban', 'unban', 'clearnick']);
			if (!known.has(parsed.cmd)) return; // important: unknown commands must submit normally

			e.preventDefault();
			e.stopImmediatePropagation();

			(async () => {
				let result = null;

				if (parsed.cmd === 'note') result = await handleNote(prefix, parsed.args);
				else if (parsed.cmd === 'unnote') result = await handleUnnote(prefix, parsed.args);
				else if (parsed.cmd === 'showip') result = await handleShowIp(prefix, rid, parsed.args);
				else if (parsed.cmd === 'ban') result = await handleBan(prefix, rid, myNick, parsed.args);
				else if (parsed.cmd === 'unban') result = await handleUnban(prefix, rid, parsed.args);
				else if (parsed.cmd === 'clearnick') result = await handleClearNick(prefix, parsed.args);

				if (result && result.message) {
					msg.value = result.message;
				} else {
					msg.value = buildPm('Neznámá chyba při zpracování příkazu');
				}

				nativeSubmit(form);
			})().catch((err) => {
				msg.value = buildPm(`Chyba při zpracování příkazu: ${String(err && err.message ? err.message : err)}`);
				nativeSubmit(form);
			});
		}, true);

		return true;
	}

	// Ensure it re-hooks after iframe reloads / partial loads
	tryHookOnce();
	const bootTimer = setInterval(() => {
		const ok = tryHookOnce();
		if (ok) {
			clearInterval(bootTimer);
		}
	}, 250);

	const mo = new MutationObserver(() => {
		tryHookOnce();
	});
	mo.observe(document.documentElement, { childList: true, subtree: true });
})();
