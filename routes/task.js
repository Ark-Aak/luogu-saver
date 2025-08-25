import express from 'express';
import db from '../db.js';
import {formatDate, makeStandardResponse} from "../utils.js";
import logger from "../logger.js";
import {getQueuePosition} from "../request.js";

const router = express.Router();

const statusMap = {
	0: 'Pending',
	1: 'Processing',
	2: 'Completed',
	3: 'Failed',
};

router.get('/query', async (req, res) => {
	try {
		const id = req.query.id;
		if (!id) {
			const [rows] = await db.query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100');
			const tasks = rows.map(task => ({
				...task,
				created_at: formatDate(task.created_at)
			}));
			res.json(makeStandardResponse(true, { tasks }));
		}
		else {
			const [rows] = await db.query('SELECT * FROM tasks WHERE id = ?', [id]);
			let element = rows[0];
			if (!element) throw new Error('Task not found.');
			element.created_at = formatDate(element.created_at);
			element.expire_time = formatDate(element.expire_time);
			element.status = statusMap[element.status] || 'Unknown';
			element.position = getQueuePosition(element.id);
			res.json(makeStandardResponse(true, { tasks: [element] }));
		}
	} catch (error) {
		logger.warn(`An error occurred while fetching tasks: ${error.message}`);
		res.json(makeStandardResponse(false, { message: error.message || "Failed to fetch tasks." }));
	}
});

router.get('/:id', async (req, res, next) => {
	try {
		const taskId = req.params.id;
		const [rows] = await db.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
		if (rows.length === 0) throw new Error('Task not found.');
		let task = rows[0];
		task.created_at = formatDate(task.created_at);
		task.expire_time = formatDate(task.expire_time);
		task.status = statusMap[task.status] || 'Unknown';
		task.position = getQueuePosition(task.id);
		res.render('task.njk', {title: "任务详情", task});
	} catch (error) {
		logger.warn(`An error occurred while fetching task details: ${error.message}`);
		next(error);
	}
});

export default router;