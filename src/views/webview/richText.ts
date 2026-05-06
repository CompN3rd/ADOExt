import { LitElement, html, nothing, type PropertyDeclarations } from 'lit';

export class AdoRichText extends LitElement {
    static properties: PropertyDeclarations = {
        htmlText: { attribute: 'html-text' },
        plainText: { type: Boolean, attribute: 'plain-text' },
        emptyLabel: { attribute: 'empty-label' }
    };

    htmlText = '';
    plainText = false;
    emptyLabel = '';

    protected createRenderRoot(): HTMLElement | DocumentFragment {
        return this;
    }

    render() {
        if (!this.htmlText && this.emptyLabel) {
            return html`<em class="empty">${this.emptyLabel}</em>`;
        }
        return nothing;
    }

    protected updated(): void {
        this.replaceChildren();
        if (!this.htmlText) {
            if (this.emptyLabel) {
                const empty = document.createElement('em');
                empty.className = 'empty';
                empty.textContent = this.emptyLabel;
                this.appendChild(empty);
            }
            return;
        }

        if (this.plainText) {
            this.classList.add('plain-text');
            this.textContent = this.htmlText;
            return;
        }

        this.classList.remove('plain-text');
        renderSanitizedHtml(this.htmlText, this);
    }
}

customElements.define('ado-rich-text', AdoRichText);

const ALLOWED_TAGS = new Set([
    'p', 'br', 'div', 'span',
    'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup',
    'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'code', 'pre', 'blockquote',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'img', 'figure', 'figcaption'
]);

const GLOBAL_ATTRS = new Set(['class']);
const TAG_ATTRS: Record<string, Set<string>> = {
    a: new Set(['href', 'title', 'target', 'rel']),
    img: new Set(['src', 'alt', 'width', 'height']),
    td: new Set(['colspan', 'rowspan', 'align']),
    th: new Set(['colspan', 'rowspan', 'scope', 'align']),
    ol: new Set(['type', 'start'])
};

function renderSanitizedHtml(rawHtml: string, container: HTMLElement): void {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');
    for (const child of Array.from(doc.body.childNodes)) {
        const cleaned = cleanNode(child);
        if (cleaned) {
            container.appendChild(cleaned);
        }
    }
}

function cleanNode(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(node.textContent ?? '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return null;
    }

    const source = node as Element;
    const tag = source.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
        const fragment = document.createDocumentFragment();
        for (const child of Array.from(source.childNodes)) {
            const cleaned = cleanNode(child);
            if (cleaned) {
                fragment.appendChild(cleaned);
            }
        }
        return fragment;
    }

    const element = document.createElement(tag);
    for (const attr of Array.from(source.attributes)) {
        const name = attr.name.toLowerCase();
        const tagAttrs = TAG_ATTRS[tag];
        if (!GLOBAL_ATTRS.has(name) && !(tagAttrs && tagAttrs.has(name))) {
            continue;
        }

        let value = attr.value;
        if (name === 'src' && tag === 'img') {
            value = rewriteImageSrc(value);
        }
        if ((name === 'href' || name === 'src') && !isSafeUrl(value)) {
            continue;
        }
        element.setAttribute(name, value);
    }

    if (tag === 'a') {
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
    }

    for (const child of Array.from(source.childNodes)) {
        const cleaned = cleanNode(child);
        if (cleaned) {
            element.appendChild(cleaned);
        }
    }

    return element;
}

function rewriteImageSrc(url: string): string {
    if (!url) {
        return '';
    }
    const lower = url.toLowerCase();
    if (lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('data:')) {
        return url;
    }
    if (url.startsWith('/')) {
        return `https://dev.azure.com${url}`;
    }
    return url;
}

function isSafeUrl(url: string): boolean {
    const lower = url.trim().toLowerCase();
    if (lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('#') || lower.startsWith('/')) {
        return true;
    }
    if (lower.startsWith('data:image/')) {
        const mimeEnd = lower.search(/[;,]/);
        const mime = mimeEnd > 0 ? lower.slice(0, mimeEnd) : lower;
        return mime !== 'data:image/svg+xml';
    }
    return false;
}