import db from './db.js';
import {generateRandomString, makeStandardResponse} from './utils.js';
import "dotenv/config";
import axios from "axios";
import * as cheerio from 'cheerio';
import logger, {debug} from "./logger.js";
import {createTask, updateTask} from "./taskManager.js";

let queue = [];
let requestPoint = process.env.INITIAL_REQ_POINT;
let running = 0;

export async function processTask() {
	if (!queue.length) return;
	running++;
	const task = queue.shift();
	logger.debug(`Start to process task #${task.id}. Type: ${task.type}`);
	await updateTask(task.id, 1, "We are processing your task.");
	const url = task.url;
	const headers = task.headers;
	const aid = task.aid;
	const response = await sendContentRequest(url, headers, task.type);
	if (!response.success) {
		logger.warn(`An error occurred when processing task #${task.id}`);
		await updateTask(task.id, 3, response.message);
		return;
	}
	const obj = response.data;
	try {
		if (task.type === 0) {
			await db.execute(`
                        INSERT INTO articles (id, title, content, author_uid,
                                              category, upvote, favorCount, solutionFor_pid)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE title           = VALUES(title),
                                                content         = VALUES(content),
                                                author_uid      = VALUES(author_uid),
                                                category        = VALUES(category),
                                                upvote          = VALUES(upvote),
                                                favorCount      = VALUES(favorCount),
                                                solutionFor_pid = VALUES(solutionFor_pid)`,
				[
					aid,
					obj.title,
					obj.content,
					obj.userData.uid,
					obj.category,
					obj.upvote,
					obj.favorCount,
					obj.category === 2 ? (obj.solutionFor?.pid || null) : null
				]
			);
		} else {
			await db.execute(
				`INSERT INTO pastes (id, title, content, author_uid)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE title      = VALUES(title),
                                         content    = VALUES(content),
                                         author_uid = VALUES(author_uid)`,
				[aid, aid, obj.content, obj.userData.uid]
			);
		}
	} catch (error) {
		logger.warn(`An error occurred when upserting data for task #${task.id}: ${error.message}`);
		await updateTask(task.id, 3, error.message);
		return;
	}
	await updateTask(task.id, 2, "Your task has been completed successfully.");
	running--;
	logger.debug(`Finish processing task #${task.id}`);
}

export async function c3vk(response, url, headers) {
	if (typeof response.data === 'string') {
		const c3vkMatch = response.data.match(/C3VK=([a-zA-Z0-9]+);/);
		if (c3vkMatch) {
			logger.debug(`Processing C3VK cookie for ${url.split('?')[0]}`);
			response = await axios.get(url, {
				headers: { ...headers, Cookie: `C3VK=${c3vkMatch[1]}` }
			});
		}
	}
	return response;
}

function getResponseObject(response, type = 0) {
	if (!type) {
		const $ = cheerio.load(response.data);
		const contextElement = $('#lentille-context');
		if (!contextElement.length) throw new Error("Context not found.");
		const dataObj = JSON.parse(contextElement.text().trim());
		return dataObj.data?.article;
	}
	else return response.data?.currentData?.paste;
}

export async function upsertUser(userData) {
	if (!userData || !userData.uid) return;
	const { uid, name, color } = userData;
	db.execute(`
		INSERT INTO users (id, name, color)
		VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE
			name = VALUES(name),
		 	color = VALUES(color)`,
		[uid, name, color]);
}

function getResponseUser(response) {
	const author = response.author || response.user || {};
	return {
		uid: parseInt(author.uid),
		name: author.name,
		color: author.color
	};
}

export async function sendContentRequest(url, headers, type = 0) {
	try {
		const startTime = Date.now();
		let response = await axios.get(url + "?_contentOnly=1", headers);
		if (type) response = await c3vk(response, url, headers);
		const obj = getResponseObject(response, type);
		if (!obj) throw new Error("Invalid response structure.");
		const max_length = 524288;
		let content = obj.content || obj.data;
		if (Buffer.byteLength(content, 'utf8') > max_length) {
			const buf = Buffer.from(content, 'utf8');
			let end = max_length;
			while (end > 0 && (buf[end] & 0b11000000) === 0b10000000) end--;
			content = buf.toString('utf8', 0, end) + '\n\n**WARNING:** 内容过长已截断';
		}
		obj.content = content;
		try {
			obj.userData = getResponseUser(obj);
			await upsertUser(obj.userData);
		} catch (ignore) {
			logger.warn(`Failed to upsert user when requesting ${url}`);
		}
		const endTime = Date.now();
		logger.debug(`Content fetched from ${url.split('?')[0]} in ${endTime - startTime}ms`);
		return makeStandardResponse(true, obj);
	}
	catch(error) {
		return makeStandardResponse(false, { message: error.message });
	}
}

export function processQueue() {
	setInterval(async() => {
		if (queue.length && requestPoint && running < process.env.CONCURRENCY_LIMIT) {
			requestPoint--;
			await processTask();
		}
	}, 200);
}

export function requestPointTick() {
	setInterval(() => {
		if (requestPoint >= process.env.INITIAL_REQ_POINT) return;
		requestPoint = requestPoint + 1
		logger.debug(`One request point has been restored. Now point: ${requestPoint}`);
	}, 10000);
}

export function getQueuePosition(id) {
	for (let i = 0; i < queue.length; i++) {
		if (queue[i].id === id) {
			return i + 1;
		}
	}
	return -1;
}

export async function pushQueue(task) {
	if (queue.length > process.env.QUEUE_MAX_LENGTH)
		throw new Error('The queue is full. Please try again later.');
	task.id = await createTask();
	logger.debug(`Task #${task.id} queued.`);
	queue.push(task);
	return task.id;
}
