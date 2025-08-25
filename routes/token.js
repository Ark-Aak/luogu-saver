import express from 'express';
import db from '../db.js';
import logger from "../logger.js";
import {makeStandardResponse} from "../utils.js";
import {sendContentRequest} from "../request.js";

const router = express.Router();

router.get('/apply', async (req, res, next) => {
	try {
		res.render('token_apply.njk', { title: "申请 Token" });
	} catch (error) {
		next(error);
	}
});

router.post('/generate', async (req, res) => {
	const { pasteId, uid } = req.body;
	const url = `https://www.luogu.com/paste/${pasteId}`;
	const headers = {
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36'
	};
	try {
		const value = await sendContentRequest(url, headers, 1);
		if (!value.success) {
			throw new Error(value.data.message || "Failed to fetch paste content.");
		}
		const content = value.data.content || "";
		if (content !== "lgs_register_verification") {
			throw new Error("Verification content does not match.");
		}
		if (parseInt(uid) !== value.data.userData.uid) {
			throw new Error("UID does not match.");
		}
		const token = [...Array(32)].map(() => Math.random().toString(36)[2]).join('');
		await db.execute(`
			INSERT INTO token (id, uid, role) VALUES (?, ?, 0)
			ON DUPLICATE KEY UPDATE uid = VALUES(uid), id = VALUES(id), role = VALUES(role)
		`, [token, uid]);
		res.json(makeStandardResponse(true, { token }));
	} catch (error) {
		logger.warn(`An error occurred while generating token: ${error.message}`);
		res.json(makeStandardResponse(false, { message: error.message || "Failed to generate token." }));
	}
});

export default router;