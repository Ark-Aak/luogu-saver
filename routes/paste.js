import express from 'express';
import db from '../db.js';
import {formatDate, makeStandardResponse} from '../utils.js';
import { createMarkdownRenderer } from "../renderer.js";
import {pushQueue} from "../request.js";

const router = express.Router();

async function loadRelationships(paste) {
	const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [paste.author_uid]);
	if (rows.length === 0) {
		throw new Error('Author not found');
	}
	paste.author = rows[0];
	return paste;
}

router.get('/:id', async (req, res, next) => {
	try {
		const [rows] = await db.query('SELECT * FROM pastes WHERE id = ?', [req.params.id]);
		if (rows.length === 0) {
			throw new Error('Paste not found');
		}
		const paste = await loadRelationships({
			...rows[0],
			updated_at: formatDate(rows[0].updated_at),
			created_at: formatDate(rows[0].created_at),
		});
		if (paste.deleted) {
			throw new Error(paste.deleted_reason);
		}
		function sanitizeLatex(src) {
			return src.replace(/\$\$([\s\S]*?)\$\$|\$([^\$]+)\$/g, (match, block, inline) => {
				const content = block ?? inline;
				if (/\\rule\s*{[^}]*(em|px)\s*}{[^}]*(em|px)}/.test(content))
					return inline ?
						'$\\color{red}\\text{\\textbackslash rule haven\'t supported yet.}$' :
						'$$\\color{red}\\text{\\textbackslash rule haven\'t supported yet.}$$';
				return match;
			});
		}
		const sanitized = sanitizeLatex(paste.content);
		const renderedContent = createMarkdownRenderer().renderMarkdown(sanitized);
		res.render('paste.njk', { title: `剪贴板 ${paste.id}`, paste, renderedContent });
	} catch (error) {
		next(error);
	}
});

router.get('/save/:id', async (req, res) => {
	try {
		const s = req.params.id;
		if (s.length !== 8) throw new Error('Invalid paste ID.');
		const url = `https://www.luogu.com/paste/${s}`;
		const headers = {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36'
		};
		const id = await pushQueue({ url, headers, aid: s, type: 1 });
		res.send(makeStandardResponse(true, { message: "Request queued.", result: id })).end();
	} catch (error) {
		res.send(makeStandardResponse(false, { message: error.message })).end();
	}
});

export default router;