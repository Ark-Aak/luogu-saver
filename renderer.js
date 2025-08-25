import markdownit from "markdown-it";
import markdownItAttrs from "markdown-it-attrs";
import markdownItContainer from "markdown-it-container";
import logger from "./logger.js";

export function createMarkdownRenderer() {
	const md = markdownit({
		html: true,
		linkify: true,
		typographer: true
	}).use(markdownItAttrs)
	
	md.use(markdownItContainer, "align", {
		render: (tokens, idx) => {
			if (tokens[idx].nesting === 1) {
				const m = tokens[idx].attrs ? (tokens[idx].attrs[0]?.length ? tokens[idx].attrs[0][0] : "") : "";
				const cls = m ? `md-align-${m}` : "md-align-center";
				return `<div class="${cls}">`;
			} else return "</div>";
		},
	});
	
	md.use(markdownItContainer, "epigraph", {
		render: (tokens, idx) => {
			if (tokens[idx].nesting === 1) {
				return `<div class="md-epigraph"><div class="epigraph-body">`;
			} else {
				const m = tokens[idx].info.match(/\[(.*)\]/);
				const author = m ? m[1] : "";
				const authorHtml = author
					? `<span class="epigraph-author">${md.utils.escapeHtml(author)}</span>`
					: "";
				return `</div>${authorHtml}</div>`;
			}
		},
	});
	
	["info", "warning", "success"].forEach((name) => {
		md.use(markdownItContainer, name, {
			render: (tokens, idx) => {
				const info = tokens[idx].info || "";
				if (tokens[idx].nesting === 1) {
					const titleMatch = info.match(/\[(.*?)\]/);
					const openMatch = info.match(/\{(.*?)\}/);
					const title = titleMatch ? titleMatch[1] : name.toUpperCase();
					const open = (tokens[idx].attrs ? (tokens[idx].attrs[0]?.length ? tokens[idx].attrs[0][0] : "") : "") === "open";
					let icon = "fa fa-";
					if (name === "success") icon = icon + "check-circle";
					else if (name === "warning") icon = icon + "warning";
					else icon = icon + "info-circle";
					return `<div class="md-block ${name}"><div class="md-block-title"><span>${title}</span><i class="toggle-btn fa fa-caret-${open ? "down" : "right"}"></i></div><div class="md-block-body"${open ? "" : ' style="display:none"'}>`;
				} else {
					return `</div></div>`;
				}
			},
		});
	});
	
	md.use(markdownItContainer, "cute-table", {
		render: (tokens, idx) => {
			return "";
		}
	});
	
	function renderMarkdown(src) {
		const startTime = Date.now();
		const size = Buffer.byteLength(src, 'utf8');
		const pattern = /^(:{2,})([\w|-]+)(\s*\[.*?\])?(\s*\{.*?\})?$/;
		function preprocessLine(line) {
			const match = line.match(pattern);
			if (match) {
				const colons = match[1];
				const word = match[2];
				let bracket = match[3] || "";
				let brace = match[4] || "";
				if (bracket) bracket = " " + bracket.trim();
				if (brace) brace = " " + brace.trim();
				return `${colons} ${word}${bracket}${brace}`.trim();
			}
			return line;
		}
		function replaceUI(s) {
			return s.split('<table>').join('<div class="table-container"><table class="ui structured celled table">')
				.split('</table>').join('</table></div>');
		}
		const processed = src.split(/\r?\n/).map(preprocessLine).join("\n");
		const result = replaceUI(md.render(processed));
		const endTime = Date.now();
		logger.debug(`Markdown rendered in ${endTime - startTime}ms. Size: ${size} bytes.`);
		return result;
	}
	
	return { renderMarkdown };
}

