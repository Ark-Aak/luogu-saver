import express from 'express';
import db from '../db.js';
import {formatDate, makeStandardResponse} from '../utils.js';
import { createMarkdownRenderer } from "../renderer.js";
import {pushQueue} from "../request.js";
import logger from "../logger.js";

const router = express.Router();

async function loadRelationships(article) {
	const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [article.author_uid]);
	if (rows.length === 0) {
		throw new Error('Author not found.');
	}
	article.author = rows[0];
	return article;
}

router.get('/recent', async (req, res, next) => {
	try {
		const count = 20;
		const [rows] = await db.execute(
			`SELECT a.*, u.name AS author_name, u.color AS author_color
             FROM articles a
                      LEFT JOIN users u ON a.author_uid = u.id
             WHERE deleted = false
             ORDER BY priority DESC, updated_at DESC LIMIT ?`,
			[count]
		);
		let articles = rows;
		articles.map((article) => {
			article.updated_at = formatDate(article.updated_at);
			article.created_at = formatDate(article.created_at);
			article.summary = article.content.slice(0, 200);
			article.tags = JSON.parse(article.tags);
			return article;
		});
		res.render('article_recent.njk', { title: "最近更新", articles });
	} catch (error) {
		next(error);
	}
});

router.get('/:id', async (req, res, next) => {
	try {
		const start = Date.now();
		const [rows] = await db.query('SELECT * FROM articles WHERE id = ?', [req.params.id]);
		if (rows.length === 0) {
			throw new Error('Article not found.');
		}
		const article = await loadRelationships({
			...rows[0],
			updated_at: formatDate(rows[0].updated_at),
			created_at: formatDate(rows[0].created_at),
		});
		if (article.deleted) {
			throw new Error(article.deleted_reason);
		}
		const end_1 = Date.now();
		logger.debug(`Article ${article.id} loaded from database in ${end_1 - start}ms.`);
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
		const sanitized = sanitizeLatex(article.content);
		const renderedContent = createMarkdownRenderer().renderMarkdown(sanitized);
		const end_2 = Date.now();
		logger.debug(`Article ${article.id} loaded in ${end_2 - start}ms.`);
		res.render('article.njk', { title: `${article.title}`,article, renderedContent });
	} catch (error) {
		next(error);
	}
});

router.get('/save/:id', async (req, res) => {
	try {
		const s = req.params.id;
		if (s.length !== 8) throw new Error('Invalid article ID.');
		const url = `https://www.luogu.com/article/${s}`;
		const headers = {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36'
		};
		const id = await pushQueue({ url, headers, aid: s, type: 0 });
		res.send(makeStandardResponse(true, { message: "Request queued.", result: id })).end();
	} catch (error) {
		res.send(makeStandardResponse(false, { message: error.message })).end();
	}
});

export default router;