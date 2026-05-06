"use strict";
(() => {
  // node_modules/@lit/reactive-element/css-tag.js
  var t = globalThis;
  var e = t.ShadowRoot && (void 0 === t.ShadyCSS || t.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype;
  var s = /* @__PURE__ */ Symbol();
  var o = /* @__PURE__ */ new WeakMap();
  var n = class {
    constructor(t3, e4, o5) {
      if (this._$cssResult$ = true, o5 !== s) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
      this.cssText = t3, this.t = e4;
    }
    get styleSheet() {
      let t3 = this.o;
      const s4 = this.t;
      if (e && void 0 === t3) {
        const e4 = void 0 !== s4 && 1 === s4.length;
        e4 && (t3 = o.get(s4)), void 0 === t3 && ((this.o = t3 = new CSSStyleSheet()).replaceSync(this.cssText), e4 && o.set(s4, t3));
      }
      return t3;
    }
    toString() {
      return this.cssText;
    }
  };
  var r = (t3) => new n("string" == typeof t3 ? t3 : t3 + "", void 0, s);
  var i = (t3, ...e4) => {
    const o5 = 1 === t3.length ? t3[0] : e4.reduce((e5, s4, o6) => e5 + ((t4) => {
      if (true === t4._$cssResult$) return t4.cssText;
      if ("number" == typeof t4) return t4;
      throw Error("Value passed to 'css' function must be a 'css' function result: " + t4 + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
    })(s4) + t3[o6 + 1], t3[0]);
    return new n(o5, t3, s);
  };
  var S = (s4, o5) => {
    if (e) s4.adoptedStyleSheets = o5.map((t3) => t3 instanceof CSSStyleSheet ? t3 : t3.styleSheet);
    else for (const e4 of o5) {
      const o6 = document.createElement("style"), n4 = t.litNonce;
      void 0 !== n4 && o6.setAttribute("nonce", n4), o6.textContent = e4.cssText, s4.appendChild(o6);
    }
  };
  var c = e ? (t3) => t3 : (t3) => t3 instanceof CSSStyleSheet ? ((t4) => {
    let e4 = "";
    for (const s4 of t4.cssRules) e4 += s4.cssText;
    return r(e4);
  })(t3) : t3;

  // node_modules/@lit/reactive-element/reactive-element.js
  var { is: i2, defineProperty: e2, getOwnPropertyDescriptor: h, getOwnPropertyNames: r2, getOwnPropertySymbols: o2, getPrototypeOf: n2 } = Object;
  var a = globalThis;
  var c2 = a.trustedTypes;
  var l = c2 ? c2.emptyScript : "";
  var p = a.reactiveElementPolyfillSupport;
  var d = (t3, s4) => t3;
  var u = { toAttribute(t3, s4) {
    switch (s4) {
      case Boolean:
        t3 = t3 ? l : null;
        break;
      case Object:
      case Array:
        t3 = null == t3 ? t3 : JSON.stringify(t3);
    }
    return t3;
  }, fromAttribute(t3, s4) {
    let i5 = t3;
    switch (s4) {
      case Boolean:
        i5 = null !== t3;
        break;
      case Number:
        i5 = null === t3 ? null : Number(t3);
        break;
      case Object:
      case Array:
        try {
          i5 = JSON.parse(t3);
        } catch (t4) {
          i5 = null;
        }
    }
    return i5;
  } };
  var f = (t3, s4) => !i2(t3, s4);
  var b = { attribute: true, type: String, converter: u, reflect: false, useDefault: false, hasChanged: f };
  Symbol.metadata ?? (Symbol.metadata = /* @__PURE__ */ Symbol("metadata")), a.litPropertyMetadata ?? (a.litPropertyMetadata = /* @__PURE__ */ new WeakMap());
  var y = class extends HTMLElement {
    static addInitializer(t3) {
      this._$Ei(), (this.l ?? (this.l = [])).push(t3);
    }
    static get observedAttributes() {
      return this.finalize(), this._$Eh && [...this._$Eh.keys()];
    }
    static createProperty(t3, s4 = b) {
      if (s4.state && (s4.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t3) && ((s4 = Object.create(s4)).wrapped = true), this.elementProperties.set(t3, s4), !s4.noAccessor) {
        const i5 = /* @__PURE__ */ Symbol(), h3 = this.getPropertyDescriptor(t3, i5, s4);
        void 0 !== h3 && e2(this.prototype, t3, h3);
      }
    }
    static getPropertyDescriptor(t3, s4, i5) {
      const { get: e4, set: r4 } = h(this.prototype, t3) ?? { get() {
        return this[s4];
      }, set(t4) {
        this[s4] = t4;
      } };
      return { get: e4, set(s5) {
        const h3 = e4?.call(this);
        r4?.call(this, s5), this.requestUpdate(t3, h3, i5);
      }, configurable: true, enumerable: true };
    }
    static getPropertyOptions(t3) {
      return this.elementProperties.get(t3) ?? b;
    }
    static _$Ei() {
      if (this.hasOwnProperty(d("elementProperties"))) return;
      const t3 = n2(this);
      t3.finalize(), void 0 !== t3.l && (this.l = [...t3.l]), this.elementProperties = new Map(t3.elementProperties);
    }
    static finalize() {
      if (this.hasOwnProperty(d("finalized"))) return;
      if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d("properties"))) {
        const t4 = this.properties, s4 = [...r2(t4), ...o2(t4)];
        for (const i5 of s4) this.createProperty(i5, t4[i5]);
      }
      const t3 = this[Symbol.metadata];
      if (null !== t3) {
        const s4 = litPropertyMetadata.get(t3);
        if (void 0 !== s4) for (const [t4, i5] of s4) this.elementProperties.set(t4, i5);
      }
      this._$Eh = /* @__PURE__ */ new Map();
      for (const [t4, s4] of this.elementProperties) {
        const i5 = this._$Eu(t4, s4);
        void 0 !== i5 && this._$Eh.set(i5, t4);
      }
      this.elementStyles = this.finalizeStyles(this.styles);
    }
    static finalizeStyles(s4) {
      const i5 = [];
      if (Array.isArray(s4)) {
        const e4 = new Set(s4.flat(1 / 0).reverse());
        for (const s5 of e4) i5.unshift(c(s5));
      } else void 0 !== s4 && i5.push(c(s4));
      return i5;
    }
    static _$Eu(t3, s4) {
      const i5 = s4.attribute;
      return false === i5 ? void 0 : "string" == typeof i5 ? i5 : "string" == typeof t3 ? t3.toLowerCase() : void 0;
    }
    constructor() {
      super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
    }
    _$Ev() {
      this._$ES = new Promise((t3) => this.enableUpdating = t3), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((t3) => t3(this));
    }
    addController(t3) {
      (this._$EO ?? (this._$EO = /* @__PURE__ */ new Set())).add(t3), void 0 !== this.renderRoot && this.isConnected && t3.hostConnected?.();
    }
    removeController(t3) {
      this._$EO?.delete(t3);
    }
    _$E_() {
      const t3 = /* @__PURE__ */ new Map(), s4 = this.constructor.elementProperties;
      for (const i5 of s4.keys()) this.hasOwnProperty(i5) && (t3.set(i5, this[i5]), delete this[i5]);
      t3.size > 0 && (this._$Ep = t3);
    }
    createRenderRoot() {
      const t3 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
      return S(t3, this.constructor.elementStyles), t3;
    }
    connectedCallback() {
      this.renderRoot ?? (this.renderRoot = this.createRenderRoot()), this.enableUpdating(true), this._$EO?.forEach((t3) => t3.hostConnected?.());
    }
    enableUpdating(t3) {
    }
    disconnectedCallback() {
      this._$EO?.forEach((t3) => t3.hostDisconnected?.());
    }
    attributeChangedCallback(t3, s4, i5) {
      this._$AK(t3, i5);
    }
    _$ET(t3, s4) {
      const i5 = this.constructor.elementProperties.get(t3), e4 = this.constructor._$Eu(t3, i5);
      if (void 0 !== e4 && true === i5.reflect) {
        const h3 = (void 0 !== i5.converter?.toAttribute ? i5.converter : u).toAttribute(s4, i5.type);
        this._$Em = t3, null == h3 ? this.removeAttribute(e4) : this.setAttribute(e4, h3), this._$Em = null;
      }
    }
    _$AK(t3, s4) {
      const i5 = this.constructor, e4 = i5._$Eh.get(t3);
      if (void 0 !== e4 && this._$Em !== e4) {
        const t4 = i5.getPropertyOptions(e4), h3 = "function" == typeof t4.converter ? { fromAttribute: t4.converter } : void 0 !== t4.converter?.fromAttribute ? t4.converter : u;
        this._$Em = e4;
        const r4 = h3.fromAttribute(s4, t4.type);
        this[e4] = r4 ?? this._$Ej?.get(e4) ?? r4, this._$Em = null;
      }
    }
    requestUpdate(t3, s4, i5, e4 = false, h3) {
      if (void 0 !== t3) {
        const r4 = this.constructor;
        if (false === e4 && (h3 = this[t3]), i5 ?? (i5 = r4.getPropertyOptions(t3)), !((i5.hasChanged ?? f)(h3, s4) || i5.useDefault && i5.reflect && h3 === this._$Ej?.get(t3) && !this.hasAttribute(r4._$Eu(t3, i5)))) return;
        this.C(t3, s4, i5);
      }
      false === this.isUpdatePending && (this._$ES = this._$EP());
    }
    C(t3, s4, { useDefault: i5, reflect: e4, wrapped: h3 }, r4) {
      i5 && !(this._$Ej ?? (this._$Ej = /* @__PURE__ */ new Map())).has(t3) && (this._$Ej.set(t3, r4 ?? s4 ?? this[t3]), true !== h3 || void 0 !== r4) || (this._$AL.has(t3) || (this.hasUpdated || i5 || (s4 = void 0), this._$AL.set(t3, s4)), true === e4 && this._$Em !== t3 && (this._$Eq ?? (this._$Eq = /* @__PURE__ */ new Set())).add(t3));
    }
    async _$EP() {
      this.isUpdatePending = true;
      try {
        await this._$ES;
      } catch (t4) {
        Promise.reject(t4);
      }
      const t3 = this.scheduleUpdate();
      return null != t3 && await t3, !this.isUpdatePending;
    }
    scheduleUpdate() {
      return this.performUpdate();
    }
    performUpdate() {
      if (!this.isUpdatePending) return;
      if (!this.hasUpdated) {
        if (this.renderRoot ?? (this.renderRoot = this.createRenderRoot()), this._$Ep) {
          for (const [t5, s5] of this._$Ep) this[t5] = s5;
          this._$Ep = void 0;
        }
        const t4 = this.constructor.elementProperties;
        if (t4.size > 0) for (const [s5, i5] of t4) {
          const { wrapped: t5 } = i5, e4 = this[s5];
          true !== t5 || this._$AL.has(s5) || void 0 === e4 || this.C(s5, void 0, i5, e4);
        }
      }
      let t3 = false;
      const s4 = this._$AL;
      try {
        t3 = this.shouldUpdate(s4), t3 ? (this.willUpdate(s4), this._$EO?.forEach((t4) => t4.hostUpdate?.()), this.update(s4)) : this._$EM();
      } catch (s5) {
        throw t3 = false, this._$EM(), s5;
      }
      t3 && this._$AE(s4);
    }
    willUpdate(t3) {
    }
    _$AE(t3) {
      this._$EO?.forEach((t4) => t4.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t3)), this.updated(t3);
    }
    _$EM() {
      this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = false;
    }
    get updateComplete() {
      return this.getUpdateComplete();
    }
    getUpdateComplete() {
      return this._$ES;
    }
    shouldUpdate(t3) {
      return true;
    }
    update(t3) {
      this._$Eq && (this._$Eq = this._$Eq.forEach((t4) => this._$ET(t4, this[t4]))), this._$EM();
    }
    updated(t3) {
    }
    firstUpdated(t3) {
    }
  };
  y.elementStyles = [], y.shadowRootOptions = { mode: "open" }, y[d("elementProperties")] = /* @__PURE__ */ new Map(), y[d("finalized")] = /* @__PURE__ */ new Map(), p?.({ ReactiveElement: y }), (a.reactiveElementVersions ?? (a.reactiveElementVersions = [])).push("2.1.2");

  // node_modules/lit-html/lit-html.js
  var t2 = globalThis;
  var i3 = (t3) => t3;
  var s2 = t2.trustedTypes;
  var e3 = s2 ? s2.createPolicy("lit-html", { createHTML: (t3) => t3 }) : void 0;
  var h2 = "$lit$";
  var o3 = `lit$${Math.random().toFixed(9).slice(2)}$`;
  var n3 = "?" + o3;
  var r3 = `<${n3}>`;
  var l2 = document;
  var c3 = () => l2.createComment("");
  var a2 = (t3) => null === t3 || "object" != typeof t3 && "function" != typeof t3;
  var u2 = Array.isArray;
  var d2 = (t3) => u2(t3) || "function" == typeof t3?.[Symbol.iterator];
  var f2 = "[ 	\n\f\r]";
  var v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
  var _ = /-->/g;
  var m = />/g;
  var p2 = RegExp(`>|${f2}(?:([^\\s"'>=/]+)(${f2}*=${f2}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g");
  var g = /'/g;
  var $ = /"/g;
  var y2 = /^(?:script|style|textarea|title)$/i;
  var x = (t3) => (i5, ...s4) => ({ _$litType$: t3, strings: i5, values: s4 });
  var b2 = x(1);
  var w = x(2);
  var T = x(3);
  var E = /* @__PURE__ */ Symbol.for("lit-noChange");
  var A = /* @__PURE__ */ Symbol.for("lit-nothing");
  var C = /* @__PURE__ */ new WeakMap();
  var P = l2.createTreeWalker(l2, 129);
  function V(t3, i5) {
    if (!u2(t3) || !t3.hasOwnProperty("raw")) throw Error("invalid template strings array");
    return void 0 !== e3 ? e3.createHTML(i5) : i5;
  }
  var N = (t3, i5) => {
    const s4 = t3.length - 1, e4 = [];
    let n4, l3 = 2 === i5 ? "<svg>" : 3 === i5 ? "<math>" : "", c4 = v;
    for (let i6 = 0; i6 < s4; i6++) {
      const s5 = t3[i6];
      let a3, u3, d3 = -1, f3 = 0;
      for (; f3 < s5.length && (c4.lastIndex = f3, u3 = c4.exec(s5), null !== u3); ) f3 = c4.lastIndex, c4 === v ? "!--" === u3[1] ? c4 = _ : void 0 !== u3[1] ? c4 = m : void 0 !== u3[2] ? (y2.test(u3[2]) && (n4 = RegExp("</" + u3[2], "g")), c4 = p2) : void 0 !== u3[3] && (c4 = p2) : c4 === p2 ? ">" === u3[0] ? (c4 = n4 ?? v, d3 = -1) : void 0 === u3[1] ? d3 = -2 : (d3 = c4.lastIndex - u3[2].length, a3 = u3[1], c4 = void 0 === u3[3] ? p2 : '"' === u3[3] ? $ : g) : c4 === $ || c4 === g ? c4 = p2 : c4 === _ || c4 === m ? c4 = v : (c4 = p2, n4 = void 0);
      const x2 = c4 === p2 && t3[i6 + 1].startsWith("/>") ? " " : "";
      l3 += c4 === v ? s5 + r3 : d3 >= 0 ? (e4.push(a3), s5.slice(0, d3) + h2 + s5.slice(d3) + o3 + x2) : s5 + o3 + (-2 === d3 ? i6 : x2);
    }
    return [V(t3, l3 + (t3[s4] || "<?>") + (2 === i5 ? "</svg>" : 3 === i5 ? "</math>" : "")), e4];
  };
  var S2 = class _S {
    constructor({ strings: t3, _$litType$: i5 }, e4) {
      let r4;
      this.parts = [];
      let l3 = 0, a3 = 0;
      const u3 = t3.length - 1, d3 = this.parts, [f3, v2] = N(t3, i5);
      if (this.el = _S.createElement(f3, e4), P.currentNode = this.el.content, 2 === i5 || 3 === i5) {
        const t4 = this.el.content.firstChild;
        t4.replaceWith(...t4.childNodes);
      }
      for (; null !== (r4 = P.nextNode()) && d3.length < u3; ) {
        if (1 === r4.nodeType) {
          if (r4.hasAttributes()) for (const t4 of r4.getAttributeNames()) if (t4.endsWith(h2)) {
            const i6 = v2[a3++], s4 = r4.getAttribute(t4).split(o3), e5 = /([.?@])?(.*)/.exec(i6);
            d3.push({ type: 1, index: l3, name: e5[2], strings: s4, ctor: "." === e5[1] ? I : "?" === e5[1] ? L : "@" === e5[1] ? z : H }), r4.removeAttribute(t4);
          } else t4.startsWith(o3) && (d3.push({ type: 6, index: l3 }), r4.removeAttribute(t4));
          if (y2.test(r4.tagName)) {
            const t4 = r4.textContent.split(o3), i6 = t4.length - 1;
            if (i6 > 0) {
              r4.textContent = s2 ? s2.emptyScript : "";
              for (let s4 = 0; s4 < i6; s4++) r4.append(t4[s4], c3()), P.nextNode(), d3.push({ type: 2, index: ++l3 });
              r4.append(t4[i6], c3());
            }
          }
        } else if (8 === r4.nodeType) if (r4.data === n3) d3.push({ type: 2, index: l3 });
        else {
          let t4 = -1;
          for (; -1 !== (t4 = r4.data.indexOf(o3, t4 + 1)); ) d3.push({ type: 7, index: l3 }), t4 += o3.length - 1;
        }
        l3++;
      }
    }
    static createElement(t3, i5) {
      const s4 = l2.createElement("template");
      return s4.innerHTML = t3, s4;
    }
  };
  function M(t3, i5, s4 = t3, e4) {
    if (i5 === E) return i5;
    let h3 = void 0 !== e4 ? s4._$Co?.[e4] : s4._$Cl;
    const o5 = a2(i5) ? void 0 : i5._$litDirective$;
    return h3?.constructor !== o5 && (h3?._$AO?.(false), void 0 === o5 ? h3 = void 0 : (h3 = new o5(t3), h3._$AT(t3, s4, e4)), void 0 !== e4 ? (s4._$Co ?? (s4._$Co = []))[e4] = h3 : s4._$Cl = h3), void 0 !== h3 && (i5 = M(t3, h3._$AS(t3, i5.values), h3, e4)), i5;
  }
  var R = class {
    constructor(t3, i5) {
      this._$AV = [], this._$AN = void 0, this._$AD = t3, this._$AM = i5;
    }
    get parentNode() {
      return this._$AM.parentNode;
    }
    get _$AU() {
      return this._$AM._$AU;
    }
    u(t3) {
      const { el: { content: i5 }, parts: s4 } = this._$AD, e4 = (t3?.creationScope ?? l2).importNode(i5, true);
      P.currentNode = e4;
      let h3 = P.nextNode(), o5 = 0, n4 = 0, r4 = s4[0];
      for (; void 0 !== r4; ) {
        if (o5 === r4.index) {
          let i6;
          2 === r4.type ? i6 = new k(h3, h3.nextSibling, this, t3) : 1 === r4.type ? i6 = new r4.ctor(h3, r4.name, r4.strings, this, t3) : 6 === r4.type && (i6 = new Z(h3, this, t3)), this._$AV.push(i6), r4 = s4[++n4];
        }
        o5 !== r4?.index && (h3 = P.nextNode(), o5++);
      }
      return P.currentNode = l2, e4;
    }
    p(t3) {
      let i5 = 0;
      for (const s4 of this._$AV) void 0 !== s4 && (void 0 !== s4.strings ? (s4._$AI(t3, s4, i5), i5 += s4.strings.length - 2) : s4._$AI(t3[i5])), i5++;
    }
  };
  var k = class _k {
    get _$AU() {
      return this._$AM?._$AU ?? this._$Cv;
    }
    constructor(t3, i5, s4, e4) {
      this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t3, this._$AB = i5, this._$AM = s4, this.options = e4, this._$Cv = e4?.isConnected ?? true;
    }
    get parentNode() {
      let t3 = this._$AA.parentNode;
      const i5 = this._$AM;
      return void 0 !== i5 && 11 === t3?.nodeType && (t3 = i5.parentNode), t3;
    }
    get startNode() {
      return this._$AA;
    }
    get endNode() {
      return this._$AB;
    }
    _$AI(t3, i5 = this) {
      t3 = M(this, t3, i5), a2(t3) ? t3 === A || null == t3 || "" === t3 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t3 !== this._$AH && t3 !== E && this._(t3) : void 0 !== t3._$litType$ ? this.$(t3) : void 0 !== t3.nodeType ? this.T(t3) : d2(t3) ? this.k(t3) : this._(t3);
    }
    O(t3) {
      return this._$AA.parentNode.insertBefore(t3, this._$AB);
    }
    T(t3) {
      this._$AH !== t3 && (this._$AR(), this._$AH = this.O(t3));
    }
    _(t3) {
      this._$AH !== A && a2(this._$AH) ? this._$AA.nextSibling.data = t3 : this.T(l2.createTextNode(t3)), this._$AH = t3;
    }
    $(t3) {
      const { values: i5, _$litType$: s4 } = t3, e4 = "number" == typeof s4 ? this._$AC(t3) : (void 0 === s4.el && (s4.el = S2.createElement(V(s4.h, s4.h[0]), this.options)), s4);
      if (this._$AH?._$AD === e4) this._$AH.p(i5);
      else {
        const t4 = new R(e4, this), s5 = t4.u(this.options);
        t4.p(i5), this.T(s5), this._$AH = t4;
      }
    }
    _$AC(t3) {
      let i5 = C.get(t3.strings);
      return void 0 === i5 && C.set(t3.strings, i5 = new S2(t3)), i5;
    }
    k(t3) {
      u2(this._$AH) || (this._$AH = [], this._$AR());
      const i5 = this._$AH;
      let s4, e4 = 0;
      for (const h3 of t3) e4 === i5.length ? i5.push(s4 = new _k(this.O(c3()), this.O(c3()), this, this.options)) : s4 = i5[e4], s4._$AI(h3), e4++;
      e4 < i5.length && (this._$AR(s4 && s4._$AB.nextSibling, e4), i5.length = e4);
    }
    _$AR(t3 = this._$AA.nextSibling, s4) {
      for (this._$AP?.(false, true, s4); t3 !== this._$AB; ) {
        const s5 = i3(t3).nextSibling;
        i3(t3).remove(), t3 = s5;
      }
    }
    setConnected(t3) {
      void 0 === this._$AM && (this._$Cv = t3, this._$AP?.(t3));
    }
  };
  var H = class {
    get tagName() {
      return this.element.tagName;
    }
    get _$AU() {
      return this._$AM._$AU;
    }
    constructor(t3, i5, s4, e4, h3) {
      this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t3, this.name = i5, this._$AM = e4, this.options = h3, s4.length > 2 || "" !== s4[0] || "" !== s4[1] ? (this._$AH = Array(s4.length - 1).fill(new String()), this.strings = s4) : this._$AH = A;
    }
    _$AI(t3, i5 = this, s4, e4) {
      const h3 = this.strings;
      let o5 = false;
      if (void 0 === h3) t3 = M(this, t3, i5, 0), o5 = !a2(t3) || t3 !== this._$AH && t3 !== E, o5 && (this._$AH = t3);
      else {
        const e5 = t3;
        let n4, r4;
        for (t3 = h3[0], n4 = 0; n4 < h3.length - 1; n4++) r4 = M(this, e5[s4 + n4], i5, n4), r4 === E && (r4 = this._$AH[n4]), o5 || (o5 = !a2(r4) || r4 !== this._$AH[n4]), r4 === A ? t3 = A : t3 !== A && (t3 += (r4 ?? "") + h3[n4 + 1]), this._$AH[n4] = r4;
      }
      o5 && !e4 && this.j(t3);
    }
    j(t3) {
      t3 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t3 ?? "");
    }
  };
  var I = class extends H {
    constructor() {
      super(...arguments), this.type = 3;
    }
    j(t3) {
      this.element[this.name] = t3 === A ? void 0 : t3;
    }
  };
  var L = class extends H {
    constructor() {
      super(...arguments), this.type = 4;
    }
    j(t3) {
      this.element.toggleAttribute(this.name, !!t3 && t3 !== A);
    }
  };
  var z = class extends H {
    constructor(t3, i5, s4, e4, h3) {
      super(t3, i5, s4, e4, h3), this.type = 5;
    }
    _$AI(t3, i5 = this) {
      if ((t3 = M(this, t3, i5, 0) ?? A) === E) return;
      const s4 = this._$AH, e4 = t3 === A && s4 !== A || t3.capture !== s4.capture || t3.once !== s4.once || t3.passive !== s4.passive, h3 = t3 !== A && (s4 === A || e4);
      e4 && this.element.removeEventListener(this.name, this, s4), h3 && this.element.addEventListener(this.name, this, t3), this._$AH = t3;
    }
    handleEvent(t3) {
      "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t3) : this._$AH.handleEvent(t3);
    }
  };
  var Z = class {
    constructor(t3, i5, s4) {
      this.element = t3, this.type = 6, this._$AN = void 0, this._$AM = i5, this.options = s4;
    }
    get _$AU() {
      return this._$AM._$AU;
    }
    _$AI(t3) {
      M(this, t3);
    }
  };
  var B = t2.litHtmlPolyfillSupport;
  B?.(S2, k), (t2.litHtmlVersions ?? (t2.litHtmlVersions = [])).push("3.3.2");
  var D = (t3, i5, s4) => {
    const e4 = s4?.renderBefore ?? i5;
    let h3 = e4._$litPart$;
    if (void 0 === h3) {
      const t4 = s4?.renderBefore ?? null;
      e4._$litPart$ = h3 = new k(i5.insertBefore(c3(), t4), t4, void 0, s4 ?? {});
    }
    return h3._$AI(t3), h3;
  };

  // node_modules/lit-element/lit-element.js
  var s3 = globalThis;
  var i4 = class extends y {
    constructor() {
      super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
    }
    createRenderRoot() {
      var _a;
      const t3 = super.createRenderRoot();
      return (_a = this.renderOptions).renderBefore ?? (_a.renderBefore = t3.firstChild), t3;
    }
    update(t3) {
      const r4 = this.render();
      this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t3), this._$Do = D(r4, this.renderRoot, this.renderOptions);
    }
    connectedCallback() {
      super.connectedCallback(), this._$Do?.setConnected(true);
    }
    disconnectedCallback() {
      super.disconnectedCallback(), this._$Do?.setConnected(false);
    }
    render() {
      return E;
    }
  };
  i4._$litElement$ = true, i4["finalized"] = true, s3.litElementHydrateSupport?.({ LitElement: i4 });
  var o4 = s3.litElementPolyfillSupport;
  o4?.({ LitElement: i4 });
  (s3.litElementVersions ?? (s3.litElementVersions = [])).push("4.2.2");

  // src/views/webview/commonStyles.ts
  var baseStyles = i`
    :host {
        display: block;
        min-height: 100vh;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
    }

    .shell {
        padding: 16px;
    }

    h1 {
        margin: 0 0 4px;
        font-size: 1.3em;
        font-weight: 600;
    }

    h2 {
        font-size: 1em;
        border-bottom: 1px solid var(--vscode-panel-border);
        padding-bottom: 4px;
        margin: 0 0 8px;
    }

    .section {
        margin-bottom: 20px;
    }

    .toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
        flex-wrap: wrap;
        align-items: center;
    }

    button,
    select,
    textarea,
    input {
        font: inherit;
    }

    .btn {
        padding: 4px 10px;
        border-radius: 3px;
        border: 1px solid var(--vscode-button-border, transparent);
        cursor: pointer;
        font-size: 0.85em;
    }

    .btn-primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }

    .btn-primary:hover {
        background: var(--vscode-button-hoverBackground);
    }

    .btn-secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
    }

    .btn-secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }

    .btn-link {
        background: transparent;
        border: none;
        color: var(--vscode-textLink-foreground);
        padding: 0;
        cursor: pointer;
        text-align: left;
    }

    .btn-link:hover {
        color: var(--vscode-textLink-activeForeground);
        text-decoration: underline;
    }

    .empty {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
    }

    .meta {
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
    }

    .badge {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.8em;
    }

    .reply-input {
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 3px;
        padding: 6px 8px;
        resize: vertical;
        box-sizing: border-box;
    }

    select {
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border);
        border-radius: 3px;
        padding: 3px 22px 3px 6px;
    }

    .check-state {
        font-size: 0.8em;
        min-width: 80px;
        padding: 2px 6px;
        border-radius: 3px;
        text-align: center;
        border: 1px solid;
    }

    .check-success { color: var(--vscode-charts-green); border-color: var(--vscode-charts-green); }
    .check-failure { color: var(--vscode-charts-red); border-color: var(--vscode-charts-red); }
    .check-pending { color: var(--vscode-charts-yellow); border-color: var(--vscode-charts-yellow); }
    .check-neutral { color: var(--vscode-descriptionForeground); border-color: var(--vscode-panel-border); }

    @media (max-width: 720px) {
        .shell {
            padding: 12px;
        }
    }
`;

  // src/views/webview/vscodeApi.ts
  var api;
  function vscode() {
    if (!api) {
      api = acquireVsCodeApi();
    }
    return api;
  }
  function readInitialData() {
    const element = document.getElementById("adoext-data");
    if (!element?.textContent) {
      throw new Error("Missing ADOExt webview data.");
    }
    return JSON.parse(element.textContent);
  }
  function postMessage(message) {
    vscode().postMessage(message);
  }

  // src/views/webview/planning.ts
  var BACKLOG_TYPES = /* @__PURE__ */ new Set(["epic", "feature", "user story", "product backlog item", "pbi", "requirement", "bug"]);
  var AdoPlanningApp = class extends i4 {
    constructor() {
      super(...arguments);
      this.model = readInitialData();
      this.filter = "";
      this.sortMode = "name";
      this.collapsed = /* @__PURE__ */ new Set();
      this.expandAll = () => {
        this.collapsed = /* @__PURE__ */ new Set();
      };
      this.collapseAll = () => {
        const next = /* @__PURE__ */ new Set();
        for (const scope of this.model.scopes) {
          const items = this.model.items.filter((item) => item.scopeKey === this.scopeKey(scope));
          for (const item of items) {
            next.add(`backlog-${scope.organization}-${scope.project}-${item.id}`);
          }
          for (const item of items) {
            if (item.iteration) {
              next.add(`sprint-${scope.organization}-${scope.project}-${item.iteration}`);
            }
          }
        }
        this.collapsed = next;
      };
      this.onFilter = (event) => {
        this.filter = event.target.value.trim();
      };
      this.onSort = (event) => {
        this.sortMode = event.target.value === "date" ? "date" : "name";
      };
      this.clearFilter = () => {
        this.filter = "";
      };
    }
    render() {
      const canExpand = this.model.kind === "backlog" || this.model.kind === "sprint";
      return b2`<main class="shell">
            <div class="header"><div><h1>${this.model.title}</h1><div class="subtitle">${this.model.subtitle}</div></div><div class="toolbar">${canExpand ? b2`<button class="btn btn-secondary" @click=${this.expandAll}>Expand all</button><button class="btn btn-secondary" @click=${this.collapseAll}>Collapse all</button>` : A}<button class="btn btn-primary" @click=${() => this.send({ type: "quickCreate" })}>+ New Item</button><button class="btn btn-secondary" @click=${() => this.send({ type: "refresh" })}>Refresh</button></div></div>
            <div class="filter-sort-controls"><label for="filter-input">Filter</label><input id="filter-input" type="text" placeholder="e.g. bug|critical" .value=${this.filter} @input=${this.onFilter}><label for="sort-select">Sort</label><select id="sort-select" .value=${this.sortMode} @change=${this.onSort}><option value="name">Name (A-Z)</option><option value="date">ID</option></select><button class="btn btn-small" @click=${this.clearFilter}>Clear</button></div>
            ${this.model.items.length === 0 ? b2`<p class="empty">No planning work items found.</p>` : this.model.scopes.map((scope) => this.renderScope(scope))}
        </main>`;
    }
    renderScope(scope) {
      const items = this.sorted(this.model.items.filter((item) => item.scopeKey === this.scopeKey(scope))).filter((item) => this.itemMatches(item));
      const body = this.model.kind === "backlog" ? this.renderBacklog(scope, items) : this.model.kind === "board" ? this.renderBoard(scope, items) : this.renderSprint(scope, items);
      return b2`<section class="scope"><h2 class="scope-title">${scope.label} <span class="scope-count">${items.length}</span><button class="btn btn-primary btn-small scope-new-item" @click=${() => this.send({ type: "quickCreate", organization: scope.organization, project: scope.project })}>+ New Item</button></h2>${body}</section>`;
    }
    renderBacklog(scope, items) {
      if (!items.length) {
        return b2`<p class="empty">No backlog items in this project.</p>`;
      }
      const ids = new Set(items.map((item) => item.id));
      const roots = items.filter((item) => item.parentId === void 0 || !ids.has(item.parentId));
      return b2`<div class="backlog" role="tree">${roots.map((root) => this.renderBacklogItem(scope, root, items, 0, /* @__PURE__ */ new Set()))}</div>`;
    }
    renderBacklogItem(scope, item, items, depth, seen) {
      if (seen.has(item.id)) {
        return A;
      }
      seen.add(item.id);
      const children = this.sorted(items.filter((candidate) => candidate.parentId === item.id));
      const key = `backlog-${scope.organization}-${scope.project}-${item.id}`;
      const isCollapsed = this.collapsed.has(key);
      return b2`${this.renderItemRow(item, depth, children.length > 0, key, isCollapsed)}${children.length && !isCollapsed ? b2`<div role="group">${children.map((child) => this.renderBacklogItem(scope, child, items, depth + 1, new Set(seen)))}</div>` : A}`;
    }
    renderBoard(scope, items) {
      if (!items.length) {
        return b2`<p class="empty">No board items in this project.</p>`;
      }
      const states = uniqueSortedStates(items);
      const lanes = this.boardLanes(items);
      const gridTemplate = `minmax(200px, 1.4fr) ${states.map(() => "minmax(220px, 1fr)").join(" ")}`;
      return b2`<div class="board-table" style=${`grid-template-columns:${gridTemplate}`}><div class="board-cell lane-corner"></div>${states.map((state) => b2`<div class="board-cell board-head">${state}</div>`)}${lanes.map((lane) => b2`${this.renderLaneHead(lane.parent)}${states.map((state) => b2`<div class="board-cell lane-cell">${lane.cards.filter((card) => card.state === state).map((card) => this.renderCard(card))}</div>`)}`)}</div>`;
    }
    renderSprint(scope, items) {
      if (!items.length) {
        return b2`<p class="empty">No sprint items in this project.</p>`;
      }
      const byIteration = /* @__PURE__ */ new Map();
      for (const item of items) {
        const iteration = item.iteration || "Unscheduled";
        byIteration.set(iteration, [...byIteration.get(iteration) ?? [], item]);
      }
      return b2`${[...byIteration.entries()].sort((a3, b3) => a3[0].localeCompare(b3[0])).map(([iteration, iterationItems]) => {
        const key = `sprint-${scope.organization}-${scope.project}-${iteration}`;
        const isCollapsed = this.collapsed.has(key);
        const lanes = this.boardLanes(iterationItems, items);
        return b2`<section class="sprint"><header class="sprint-head" role="button" tabindex="0" aria-expanded=${String(!isCollapsed)} @click=${() => this.toggle(key)} @keydown=${(event) => this.toggleOnKey(event, key)}><h3><span class="chev ${isCollapsed ? "collapsed-chev" : ""}">v</span>${iterationLabel(iteration)}</h3><span class="meta">${iterationItems.length} item${iterationItems.length === 1 ? "" : "s"} · ${iteration}</span></header>${!isCollapsed ? b2`<div class="sprint-body">${lanes.map((lane) => b2`<div class="sprint-parent">${lane.parent ? this.renderSprintParent(lane.parent) : b2`<div class="sprint-parent-header"><span class="title">Unparented</span><span class="meta">${lane.cards.length}</span></div>`}${lane.cards.length ? lane.cards.map((card) => this.renderSprintTask(card)) : b2`<div class="meta" style="padding-left:26px;">No child items.</div>`}</div>`)}</div>` : A}</section>`;
      })}`;
    }
    renderItemRow(item, depth, hasChildren, key, isCollapsed) {
      return b2`<div class="tree-row" role="treeitem" style=${`--depth:${depth}`}><div class="title-line">${hasChildren ? b2`<button class="tree-twisty" type="button" aria-expanded=${String(!isCollapsed)} aria-label=${`Toggle children of work item ${item.id}`} @click=${() => this.toggle(key)}><span class="chev ${isCollapsed ? "collapsed-chev" : ""}">v</span></button>` : b2`<span class="tree-twisty placeholder" aria-hidden="true"></span>`}${this.renderItemTitle(item)}${this.renderMetaActions(item, true)}</div>${this.renderStateControl(item)}</div>`;
    }
    renderCard(item) {
      return b2`<article class="card"><div class="card-title">${this.renderItemTitle(item)}</div>${this.renderMetaActions(item, false)}<div class="card-footer">${this.renderStateControl(item)}</div></article>`;
    }
    renderSprintTask(item) {
      return b2`<div class="sprint-task"><div class="title-line">${this.renderItemTitle(item)}${this.renderMetaActions(item, true)}</div>${this.renderStateControl(item)}</div>`;
    }
    renderSprintParent(item) {
      return b2`<div class="sprint-parent-header">${this.renderItemTitle(item)}${item.state ? b2`<span class="state-badge">${item.state}</span>` : A}</div>`;
    }
    renderLaneHead(item) {
      if (!item) {
        return b2`<div class="board-cell lane-head"><div class="title-line"><span class="title">Unparented</span></div></div>`;
      }
      return b2`<div class="board-cell lane-head"><div class="title-line">${this.renderItemTitle(item)}<span class="meta">${item.assignee}</span></div></div>`;
    }
    renderItemTitle(item) {
      return b2`<span class="type ${item.typeClass}">${item.workItemType}</span><span class="id">#${item.id}</span><button class="btn-link" @click=${() => this.send({ type: "openWorkItem", id: item.id, organization: item.organization, project: item.project })}><span class="title">${item.title}</span></button>`;
    }
    renderMetaActions(item, prefixed) {
      return b2`${prefixed ? b2`<span class="meta">·</span>` : A}<button class="btn-link meta-edit" title="Edit assignee" @click=${() => this.send({ type: "editAssignee", id: item.id, organization: item.organization, project: item.project })}>${item.assignee}</button><span class="meta">·</span><button class="btn-link meta-edit" title="Edit iteration" @click=${() => this.send({ type: "editIteration", id: item.id, organization: item.organization, project: item.project })}>${item.iterationLabel || "No iteration"}</button>`;
    }
    renderStateControl(item) {
      return b2`<div class="state-control"><select aria-label=${`State for work item ${item.id}`}>${item.allowedStates.map((state) => b2`<option value=${state} ?selected=${state === item.state}>${state}</option>`)}</select><button class="btn btn-primary" @click=${(event) => this.saveState(event, item)}>Save</button></div>`;
    }
    saveState(event, item) {
      const select = event.currentTarget.closest(".state-control")?.querySelector("select");
      if (!select?.value) {
        return;
      }
      this.send({ type: "setState", id: item.id, state: select.value, organization: item.organization, project: item.project });
    }
    boardLanes(items, laneLookupItems = items) {
      const itemsById = new Map(laneLookupItems.map((item) => [item.id, item]));
      const lanes = /* @__PURE__ */ new Map();
      const orphanCandidates = [];
      for (const item of items) {
        const owner = laneOwner(item, itemsById);
        if (owner && item.id !== owner.id) {
          if (!lanes.has(owner.id)) {
            lanes.set(owner.id, { parent: owner, cards: [] });
          }
          lanes.get(owner.id).cards.push(item);
        } else {
          orphanCandidates.push(item);
        }
      }
      const result = [...lanes.values()].sort((a3, b3) => compareItems(a3.parent, b3.parent));
      const orphanCards = orphanCandidates.filter((item) => !lanes.has(item.id));
      if (orphanCards.length) {
        result.push({ cards: orphanCards });
      }
      return result;
    }
    sorted(items) {
      return [...items].sort(this.sortMode === "name" ? compareByName : compareItems);
    }
    itemMatches(item) {
      if (!this.filter) {
        return true;
      }
      try {
        const regex = new RegExp(this.filter, "i");
        return regex.test(`#${item.id} ${item.title} ${item.workItemType} ${item.state} ${item.assignee} ${item.iteration}`);
      } catch {
        return true;
      }
    }
    toggle(key) {
      const next = new Set(this.collapsed);
      next.has(key) ? next.delete(key) : next.add(key);
      this.collapsed = next;
    }
    toggleOnKey(event, key) {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      this.toggle(key);
    }
    scopeKey(scope) {
      return `${scope.organization}\0${scope.project}`;
    }
    send(message) {
      postMessage(message);
    }
  };
  AdoPlanningApp.properties = {
    model: { state: true },
    filter: { state: true },
    sortMode: { state: true },
    collapsed: { state: true }
  };
  AdoPlanningApp.styles = [baseStyles, i`
        h1 { font-size: 1.25rem; }
        .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
        .subtitle { color: var(--vscode-descriptionForeground); margin-top: 4px; }
        .scope { margin: 0 0 22px; }
        .scope-title { font-size: 0.98rem; font-weight: 600; margin: 0 0 8px; color: var(--vscode-sideBarTitle-foreground); display: flex; align-items: center; gap: 8px; }
        .scope-count { color: var(--vscode-descriptionForeground); font-weight: 400; }
        .scope-new-item { margin-left: auto; }
        .filter-sort-controls { display: flex; gap: 10px; align-items: center; padding: 10px 12px; background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background)); border-bottom: 1px solid var(--vscode-panel-border); flex-wrap: wrap; font-size: 0.9em; margin-bottom: 12px; }
        .filter-sort-controls label { color: var(--vscode-descriptionForeground); font-weight: 500; }
        .filter-sort-controls input { padding: 4px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 3px; min-width: 180px; }
        .backlog { border-top: 1px solid var(--vscode-panel-border); }
        .tree-row, .sprint-task { display: grid; grid-template-columns: minmax(280px, 1fr) auto; align-items: center; gap: 12px; min-height: 32px; border-bottom: 1px solid var(--vscode-panel-border); }
        .tree-row { padding: 3px 8px 3px calc(8px + var(--depth, 0) * 18px); }
        .sprint-task { padding: 3px 0 3px 26px; border-bottom-style: dotted; }
        .tree-row:hover, .card:hover { background: var(--vscode-list-hoverBackground); }
        .tree-twisty { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: none; background: transparent; color: var(--vscode-foreground); cursor: pointer; padding: 0; margin-right: 2px; }
        .tree-twisty.placeholder { cursor: default; visibility: hidden; }
        .chev { display: inline-block; transition: transform 120ms ease; }
        .collapsed-chev { transform: rotate(-90deg); }
        .title-line { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
        .id { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
        .type { white-space: nowrap; padding: 1px 6px; border-radius: 8px; font-size: 0.78em; color: var(--vscode-editor-background); background: var(--vscode-charts-blue); }
        .type.epic { background: var(--vscode-charts-purple, #8a2be2); }
        .type.feature { background: var(--vscode-charts-orange, #d9822b); }
        .type.user-story, .type.product-backlog-item, .type.pbi, .type.requirement { background: var(--vscode-charts-blue, #007acc); }
        .type.bug { background: var(--vscode-charts-red, #c4314b); }
        .type.task { background: var(--vscode-charts-yellow, #d7a416); color: #000; }
        .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .state-badge { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 0.78em; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
        .state-control { display: flex; align-items: center; gap: 6px; }
        .btn-small { padding: 2px 7px; font-size: 0.82em; }
        .meta-edit { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
        .board-table { display: grid; gap: 1px; background: var(--vscode-panel-border); border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: auto; }
        .board-cell { background: var(--vscode-sideBar-background); padding: 8px; min-height: 60px; }
        .board-head, .lane-head, .lane-corner { background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background)); font-weight: 600; }
        .lane-cell { display: flex; flex-direction: column; gap: 6px; }
        .card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 6px 8px; }
        .card-title { display: flex; gap: 6px; min-width: 0; margin-bottom: 4px; flex-wrap: wrap; }
        .card-title .title { white-space: normal; }
        .card-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
        .sprint { margin-bottom: 18px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
        .sprint-head { padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background)); border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
        .sprint-head h3 { margin: 0; font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; gap: 8px; }
        .sprint-body { padding: 6px 0; }
        .sprint-parent { padding: 4px 10px; }
        .sprint-parent-header { display: flex; align-items: center; gap: 6px; padding: 4px 0; font-weight: 600; flex-wrap: wrap; }
        @media (max-width: 720px) { .tree-row, .sprint-task { grid-template-columns: 1fr; align-items: start; } .state-control { justify-content: flex-start; } .header { align-items: flex-start; flex-direction: column; } }
    `];
  function compareItems(left, right) {
    return left.id - right.id;
  }
  function compareByName(left, right) {
    return left.title.localeCompare(right.title) || compareItems(left, right);
  }
  function stateSortValue(state) {
    const value = state.toLowerCase();
    return value === "new" || value === "proposed" ? 10 : value === "active" || value === "committed" || value === "in progress" ? 20 : value === "resolved" ? 30 : value === "closed" || value === "done" ? 40 : 100;
  }
  function uniqueSortedStates(items) {
    return [...new Set(items.map((item) => item.state || "Unknown"))].sort((a3, b3) => stateSortValue(a3) - stateSortValue(b3) || a3.localeCompare(b3));
  }
  function laneOwner(item, itemsById) {
    if (BACKLOG_TYPES.has(item.workItemType.toLowerCase())) {
      return item;
    }
    let current = item;
    const visited = /* @__PURE__ */ new Set();
    while (current) {
      if (visited.has(current.id)) {
        break;
      }
      visited.add(current.id);
      if (current.parentId === void 0) {
        return void 0;
      }
      const parent = itemsById.get(current.parentId);
      if (!parent) {
        return void 0;
      }
      if (BACKLOG_TYPES.has(parent.workItemType.toLowerCase())) {
        return parent;
      }
      current = parent;
    }
    return void 0;
  }
  function iterationLabel(iterationPath) {
    const pieces = iterationPath.split("\\").filter(Boolean);
    return pieces.length ? pieces[pieces.length - 1] : iterationPath;
  }
  customElements.define("ado-planning-app", AdoPlanningApp);
})();
