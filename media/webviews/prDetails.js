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

  // src/views/webview/builds.ts
  var AdoBuildList = class extends i4 {
    constructor() {
      super(...arguments);
      this.builds = [];
      this.emptyLabel = "No builds found.";
    }
    render() {
      if (this.builds.length === 0) {
        return b2`<p class="empty">${this.emptyLabel}</p>`;
      }
      return b2`${this.builds.map((build) => this.renderBuild(build))}`;
    }
    renderBuild(build) {
      const metaParts = [build.definitionName, build.requestedFor, build.startTime].filter(Boolean);
      const statusClass = this.statusClass(build.statusKind);
      return b2`<div class="build-item">
            <span class="build-status ${statusClass}">${build.statusLabel}</span>
            <span class="build-name" title=${build.buildNumber}>${build.buildNumber}</span>
            ${metaParts.length > 0 ? b2`<span class="build-meta" title=${metaParts.join(" - ")}>${metaParts.join(" - ")}</span>` : A}
            ${build.id > 0 ? b2`<button type="button" @click=${() => this.openBuild(build.id)}>Open</button>` : A}
        </div>`;
    }
    statusClass(statusKind) {
      switch (statusKind) {
        case "succeeded":
          return "build-status-succeeded";
        case "failed":
          return "build-status-failed";
        case "inprogress":
          return "build-status-inprogress";
        default:
          return "build-status-other";
      }
    }
    openBuild(buildId) {
      this.dispatchEvent(new CustomEvent("adoext-open-build", {
        bubbles: true,
        composed: true,
        detail: { buildId }
      }));
    }
  };
  AdoBuildList.properties = {
    builds: {
      attribute: "builds-json",
      converter: {
        fromAttribute(value) {
          if (!value) {
            return [];
          }
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        }
      }
    },
    emptyLabel: { attribute: "empty-label" }
  };
  AdoBuildList.styles = i`
        :host {
            display: block;
        }

        .empty {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .build-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 6px 10px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            margin-bottom: 6px;
        }

        .build-status {
            font-size: 0.8em;
            font-weight: 600;
            padding: 2px 7px;
            border-radius: 10px;
            white-space: nowrap;
        }

        .build-status-succeeded {
            background: var(--vscode-charts-green);
            color: #fff;
        }

        .build-status-failed {
            background: var(--vscode-charts-red);
            color: #fff;
        }

        .build-status-inprogress {
            background: var(--vscode-charts-blue);
            color: #fff;
        }

        .build-status-other {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }

        .build-name {
            flex: 1;
            min-width: 120px;
            font-size: 0.9em;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .build-meta {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        button {
            padding: 4px 10px;
            border-radius: 3px;
            border: 1px solid var(--vscode-button-border, transparent);
            cursor: pointer;
            font-family: var(--vscode-font-family);
            font-size: 0.85em;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        @media (max-width: 520px) {
            .build-item {
                align-items: flex-start;
                flex-direction: column;
                gap: 6px;
            }

            .build-name,
            .build-meta {
                min-width: 0;
                max-width: 100%;
                white-space: normal;
            }
        }
    `;
  customElements.define("ado-build-list", AdoBuildList);

  // src/views/webview/prDetails.ts
  var AdoPrDetailsApp = class extends i4 {
    constructor() {
      super(...arguments);
      this.data = readInitialData();
      this._modalMode = null;
      this._mergeStrategy = 1;
      this._deleteSourceBranch = true;
      this._transitionWorkItems = true;
      this._mergeCommitMessage = "";
      this.openCompleteModal = () => {
        this._mergeCommitMessage = `Merged PR ${this.data.prId}: ${this.data.title}`;
        this._modalMode = "complete";
      };
      this.openAutoCompleteModal = () => {
        this._mergeCommitMessage = `Merged PR ${this.data.prId}: ${this.data.title}`;
        this._modalMode = "autoComplete";
      };
      this.closeModal = () => {
        this._modalMode = null;
      };
      this.onOverlayClick = () => {
        this.closeModal();
      };
      this.onMergeStrategyChange = (e4) => {
        this._mergeStrategy = Number(e4.target.value);
      };
      this.onCommitMsgInput = (e4) => {
        this._mergeCommitMessage = e4.target.value;
      };
      this.onDeleteBranchChange = (e4) => {
        this._deleteSourceBranch = e4.target.checked;
      };
      this.onTransitionWiChange = (e4) => {
        this._transitionWorkItems = e4.target.checked;
      };
      this.confirmModal = () => {
        const msg = {
          mergeStrategy: this._mergeStrategy,
          deleteSourceBranch: this._deleteSourceBranch,
          transitionWorkItems: this._transitionWorkItems,
          mergeCommitMessage: this._mergeCommitMessage
        };
        if (this._modalMode === "complete") {
          this.send({ type: "completePr", ...msg });
        } else if (this._modalMode === "autoComplete") {
          this.send({ type: "setAutoComplete", ...msg });
        }
        this._modalMode = null;
      };
      this.toggleResolvedThreads = () => {
        this.data = {
          ...this.data,
          showResolvedThreads: !this.data.showResolvedThreads
        };
        this.send({ type: "setShowResolvedThreads", showResolved: this.data.showResolvedThreads });
      };
      this.addComment = () => {
        const input = this.renderRoot.querySelector("#new-comment");
        const content = input?.value.trim();
        if (!content) {
          return;
        }
        this.send({ type: "addComment", content });
        if (input) {
          input.value = "";
        }
      };
      this.onOpenBuild = (event) => {
        const buildId = Number(event.detail?.buildId);
        if (Number.isFinite(buildId) && buildId > 0) {
          this.send({ type: "openBuild", buildId });
        }
      };
      this.openTestRun = (runId) => {
        if (Number.isFinite(runId) && runId > 0) {
          this.send({ type: "openTestRun", runId });
        }
      };
      this.copyFailureSummary = (testResults) => {
        const failures = testResults.failures ?? [];
        if (testResults.failedTests === 0) {
          return;
        }
        const lines = failures.length > 0 ? [
          `Test failures (${failures.length}${failures.length < testResults.failedTests ? ` of ${testResults.failedTests}` : ""})`,
          ...failures.map((failure) => {
            const location = [failure.buildLabel, failure.runName].filter(Boolean).join(" \xB7 ");
            const msg = failure.errorMessageSnippet ? `
  ${failure.errorMessageSnippet.split("\n")[0]}` : "";
            return `- ${failure.testName}${location ? ` (${location})` : ""}${msg}`;
          })
        ] : [
          `Test failures (${testResults.failedTests})`,
          ...testResults.runs.filter((run) => run.failedTests > 0).map((run) => `- ${run.runName}: ${run.failedTests} failing test${run.failedTests === 1 ? "" : "s"}${run.buildLabel ? ` (${run.buildLabel})` : ""}`)
        ];
        this.send({ type: "copyText", text: lines.join("\n") });
      };
    }
    render() {
      return b2`<main class="shell">
            <div class="toolbar">
                <button class="btn-primary" @click=${() => this.send({ type: "openDiff" })}>View Diff</button>
                <div class="review-actions" role="group" aria-label="Review actions">
                    ${this.data.reviewActions.map((action) => b2`<button class="btn-secondary" @click=${() => this.send({ type: "setVote", vote: action.vote })}>${action.label}</button>`)}
                </div>
                ${this.renderCompletionButtons()}
                <button class="btn-secondary" @click=${() => this.send({ type: "openInBrowser" })}>Open in Browser</button>
            </div>
            <h1>PR #${this.data.prId}: ${this.data.title}${this.data.isDraft ? b2`<span class="badge draft">Draft</span>` : A}</h1>
            <div class="meta"><strong>${this.data.author}</strong> opened on ${this.data.createdDate} · <code>${this.data.sourceBranch}</code> -> <code>${this.data.targetBranch}</code></div>
            <section class="section"><h2>Description</h2><pre class="description">${this.data.description}</pre></section>
            ${this.data.reviewers.length > 0 ? b2`<section class="section"><h2>Reviewers</h2><ul class="reviewers">${this.data.reviewers.map((reviewer) => b2`<li><span class="vote ${reviewer.voteClass}">${reviewer.voteLabel}</span>${reviewer.displayName}</li>`)}</ul></section>` : A}
            ${this.renderRows("Branch Status", this.data.branchStatuses)}
            ${this.renderRows("Build & Policy Status", this.data.checks)}
            ${this.renderTestResults(this.data.testResults)}
            <section class="section"><h2>Builds</h2><ado-build-list .builds=${this.data.builds} empty-label="No builds found." @adoext-open-build=${this.onOpenBuild}></ado-build-list></section>
            <section class="section"><h2>Comment Threads</h2>${this.renderThreads()}</section>
            <section class="section"><h2>Add Comment</h2><div class="new-comment-form"><textarea id="new-comment" rows="3" placeholder="Write a comment..."></textarea><div><button class="btn-primary" @click=${this.addComment}>Add Comment</button></div></div></section>
            ${this._modalMode ? this.renderModal() : A}
        </main>`;
    }
    renderTestResults(testResults) {
      if (!testResults) {
        return b2`
                <section class="section">
                    <h2>Test Results</h2>
                    <p class="empty">No test results found.</p>
                </section>
            `;
      }
      const failures = testResults.failures ?? [];
      const runs = testResults.runs ?? [];
      const hasPendingRuns = runs.some((run) => run.statusClass === "check-pending");
      return b2`
            <section class="section">
                <h2>Test Results</h2>
                <div class="test-summary">
                    <span>Total: ${testResults.totalTests}</span>
                    <span>Passed: ${testResults.passedTests}</span>
                    <span>Failed: ${testResults.failedTests}</span>
                    <span>Skipped: ${testResults.skippedTests}</span>
                    ${testResults.durationLabel ? b2`<span>Duration: ${testResults.durationLabel}</span>` : A}
                </div>
                <div class="toolbar">
                    ${testResults.failedTests > 0 ? b2`<button class="btn-secondary" @click=${() => this.copyFailureSummary(testResults)}>Copy Failure Summary</button>` : A}
                </div>
                ${runs.length === 0 ? b2`<p class="empty">No test runs found.</p>` : b2`
                        <ul class="test-run-list">
                            ${runs.map((run) => b2`
                                <li class="test-run">
                                    <span class="check-state ${run.statusClass} test-run-status">${run.statusLabel}</span>
                                    <span class="test-run-name">${run.runName}</span>
                                    <span class="test-counts">${run.passedTests}P / ${run.failedTests}F / ${run.skippedTests}S · ${run.totalTests} total${run.durationLabel ? b2` · ${run.durationLabel}` : A}</span>
                                    <button class="btn-secondary" @click=${() => this.openTestRun(run.runId)}>Open Run</button>
                                    ${run.buildId ? b2`<button class="btn-secondary" @click=${() => this.send({ type: "openBuild", buildId: run.buildId })}>Open Build</button>` : A}
                                </li>
                            `)}
                        </ul>
                    `}
                ${testResults.failureDetailsNotice ? b2`<p class="test-note">${testResults.failureDetailsNotice}</p>` : A}
                ${testResults.failedTests === 0 ? b2`<p class="empty">${hasPendingRuns ? "No failing tests reported yet." : "No failing tests."}</p>` : failures.length === 0 ? b2`<p class="empty">Failing tests were detected, but detailed failure records were unavailable.</p>` : b2`
                        <h3>Failed Tests</h3>
                        <ul class="test-failure-list">
                            ${failures.map((failure) => b2`
                                <li>
                                    <details class="test-failure">
                                        <summary>
                                            <span class="test-failure-name">${failure.testName}</span>
                                            <span class="test-failure-meta">${failure.buildLabel ? `${failure.buildLabel} \xB7 ` : ""}${failure.runName}</span>
                                        </summary>
                                        <div class="test-failure-body">
                                            ${failure.errorMessageSnippet ? b2`<h3>Error</h3><pre>${failure.errorMessageSnippet}</pre>` : b2`<p class="empty">No error message provided.</p>`}
                                            ${failure.stackTraceSnippet ? b2`<h3>Stack Trace</h3><pre>${failure.stackTraceSnippet}</pre>` : A}
                                            <div class="toolbar">
                                                <button class="btn-secondary" @click=${() => this.openTestRun(failure.runId)}>Open Run</button>
                                                ${failure.buildId ? b2`<button class="btn-secondary" @click=${() => this.send({ type: "openBuild", buildId: failure.buildId })}>Open Build</button>` : A}
                                            </div>
                                        </div>
                                    </details>
                                </li>
                            `)}
                        </ul>
                    `}
            </section>
        `;
    }
    renderRows(title, rows) {
      if (rows.length === 0) {
        return A;
      }
      return b2`<section class="section"><h2>${title}</h2><ul class="checks-list">${rows.map((row) => b2`<li><span class="check-state ${row.badge.className}">${row.badge.label}</span><span class="check-name">${row.name}</span>${row.description ? b2`<span class="check-desc">${row.description}</span>` : A}</li>`)}</ul></section>`;
    }
    renderThreads() {
      const resolvedCount = this.data.threads.filter((thread) => thread.isResolved).length;
      const visibleThreads = this.data.showResolvedThreads ? this.data.threads : this.data.threads.filter((thread) => !thread.isResolved);
      return b2`
            <div class="toolbar">
                <button class="btn-secondary" @click=${this.toggleResolvedThreads}>
                    ${this.data.showResolvedThreads ? "Hide resolved threads" : `Show resolved threads (${resolvedCount})`}
                </button>
            </div>
            ${visibleThreads.length === 0 ? b2`<p class="empty">No comment threads.</p>` : b2`${visibleThreads.map((thread) => this.renderThread(thread))}`}
        `;
    }
    renderThread(thread) {
      return b2`<article class="thread ${thread.isResolved ? "resolved" : ""} ${thread.isToolThread ? "tool-thread" : ""}">
            <div class="thread-header">
                <div class="thread-meta">
                    <span class="thread-status">${thread.statusLabel}</span>
                    ${thread.isToolThread ? b2`<span class="bot-badge">Bot</span>` : A}
                </div>
                <button class="btn-secondary" @click=${() => this.setThreadStatus(thread)}>${thread.isResolved ? "Reopen" : "Resolve"}</button>
            </div>
            ${thread.comments.map((comment) => this.renderComment(comment))}
            ${this.renderReplySection(thread)}
        </article>`;
    }
    renderComment(comment) {
      return b2`<div class="comment ${comment.isTool ? "tool" : ""}">
            <div class="comment-author">
                ${comment.author}
                ${comment.isTool ? b2`<span class="bot-badge">Bot</span>` : A}
            </div>
            <div class="comment-content">${comment.content}</div>
        </div>`;
    }
    renderReplySection(thread) {
      const replyForm = b2`<div class="reply-form">
            <textarea id="reply-${thread.id}" rows="2" placeholder="Reply..."></textarea>
            <button class="btn-primary" @click=${() => this.reply(thread.id)}>Reply</button>
        </div>`;
      return thread.isToolThread ? b2`<details class="reply-disclosure"><summary>Reply (expand)</summary>${replyForm}</details>` : replyForm;
    }
    renderCompletionButtons() {
      if (!this.data.canComplete) {
        return A;
      }
      if (this.data.autoCompleteSetBy) {
        return b2`
                <button class="btn-secondary" @click=${() => this.send({ type: "cancelAutoComplete" })}>Cancel Auto-Complete</button>
            `;
      }
      return b2`
            <button class="btn-primary" @click=${this.openCompleteModal} ?disabled=${this.data.hasConflicts || this.data.isDraft}>Complete</button>
            <button class="btn-secondary" @click=${this.openAutoCompleteModal} ?disabled=${this.data.isDraft}>Set Auto-Complete</button>
        `;
    }
    renderModal() {
      const isComplete = this._modalMode === "complete";
      const title = isComplete ? "Complete Pull Request" : "Set Auto-Complete";
      const confirmLabel = isComplete ? "Complete Merge" : "Set Auto-Complete";
      return b2`
            <div class="modal-overlay" @click=${this.onOverlayClick}>
                <div class="modal" @click=${(e4) => e4.stopPropagation()}>
                    <h2>${title}</h2>
                    <div class="modal-field">
                        <label>Merge Type</label>
                        <select @change=${this.onMergeStrategyChange}>
                            <option value="1" ?selected=${this._mergeStrategy === 1}>Merge (no fast-forward)</option>
                            <option value="2" ?selected=${this._mergeStrategy === 2}>Squash commit</option>
                            <option value="3" ?selected=${this._mergeStrategy === 3}>Rebase and fast-forward</option>
                            <option value="4" ?selected=${this._mergeStrategy === 4}>Semi-linear merge (rebase + merge commit)</option>
                        </select>
                    </div>
                    <div class="modal-field">
                        <label>Commit Message</label>
                        <textarea rows="3" .value=${this._mergeCommitMessage} @input=${this.onCommitMsgInput}></textarea>
                    </div>
                    <label class="modal-check">
                        <input type="checkbox" .checked=${this._deleteSourceBranch} @change=${this.onDeleteBranchChange}>
                        Delete source branch after merge
                    </label>
                    <label class="modal-check">
                        <input type="checkbox" .checked=${this._transitionWorkItems} @change=${this.onTransitionWiChange}>
                        Complete associated work items
                    </label>
                    ${this.data.associatedWorkItems.length > 0 ? b2`
                        <ul class="modal-wi-list">
                            ${this.data.associatedWorkItems.map((wi) => b2`<li>#${wi.id}: ${wi.title}</li>`)}
                        </ul>
                    ` : A}
                    <div class="modal-actions">
                        <button class="btn-secondary" @click=${this.closeModal}>Cancel</button>
                        <button class="${isComplete ? "btn-primary" : "btn-primary"}" @click=${this.confirmModal}>${confirmLabel}</button>
                    </div>
                </div>
            </div>
        `;
    }
    reply(threadId) {
      const input = this.renderRoot.querySelector(`#reply-${threadId}`);
      const content = input?.value.trim();
      if (!content) {
        return;
      }
      this.send({ type: "reply", threadId, content });
      if (input) {
        input.value = "";
      }
    }
    setThreadStatus(thread) {
      this.send({ type: "setStatus", threadId: thread.id, status: thread.isResolved ? 1 : 2 });
    }
    send(message) {
      postMessage(message);
    }
  };
  AdoPrDetailsApp.properties = {
    data: { state: true },
    _modalMode: { state: true },
    _mergeStrategy: { state: true },
    _deleteSourceBranch: { state: true },
    _transitionWorkItems: { state: true },
    _mergeCommitMessage: { state: true }
  };
  AdoPrDetailsApp.styles = i`
        :host {
            display: block;
            --tool-thread-textarea-min-height: 28px;
            --tool-thread-textarea-font-size: 0.9em;
        }
        * { box-sizing: border-box; }
        .shell { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; min-height: 100vh; }
        h1 { font-size: 1.3em; margin: 0 0 4px; line-height: 1.35; }
        .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 12px; }
        .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; margin-left: 6px; }
        .draft { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
        .section { margin-bottom: 20px; }
        .section h2 { font-size: 1em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; margin-bottom: 8px; }
        .toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
        .review-actions { display: flex; gap: 8px; align-items: center; }
        button { padding: 4px 10px; border-radius: 3px; border: 1px solid var(--vscode-button-border, transparent); cursor: pointer; font-family: inherit; font-size: 0.85em; }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .reviewers, .checks-list { list-style: none; padding: 0; margin: 0; }
        .reviewers li { margin: 4px 0; display: flex; gap: 8px; align-items: center; }
        .vote { min-width: 112px; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; text-align: center; border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
        .vote-positive { color: var(--vscode-charts-green); border-color: var(--vscode-charts-green); }
        .vote-waiting { color: var(--vscode-charts-yellow); border-color: var(--vscode-charts-yellow); }
        .vote-negative { color: var(--vscode-charts-red); border-color: var(--vscode-charts-red); }
        .checks-list li { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); }
        .checks-list li:last-child { border-bottom: none; }
        .check-state { font-size: 0.8em; min-width: 80px; padding: 2px 6px; border-radius: 3px; text-align: center; border: 1px solid; }
        .check-success { color: var(--vscode-charts-green); border-color: var(--vscode-charts-green); }
        .check-failure { color: var(--vscode-charts-red); border-color: var(--vscode-charts-red); }
        .check-pending { color: var(--vscode-charts-yellow); border-color: var(--vscode-charts-yellow); }
        .check-neutral { color: var(--vscode-descriptionForeground); border-color: var(--vscode-panel-border); }
        .check-name { flex: 1; min-width: 120px; }
        .check-desc { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
        .thread { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 10px; }
        .thread-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; background: var(--vscode-sideBarSectionHeader-background); border-radius: 4px 4px 0 0; }
        .thread-status { font-size: 0.8em; color: var(--vscode-descriptionForeground); }
        .thread-meta { display: flex; align-items: center; gap: 8px; }
        .resolved .thread-header { opacity: 0.7; }
        .tool-thread { border-style: dashed; opacity: 0.9; }
        .comment { padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
        .comment.tool { border-left: 3px solid var(--vscode-descriptionForeground); }
        .comment:last-child { border-bottom: none; }
        .comment-author { font-weight: bold; font-size: 0.85em; margin-bottom: 2px; display: flex; align-items: center; gap: 6px; }
        .bot-badge { display: inline-flex; align-items: center; border: 1px solid var(--vscode-panel-border); border-radius: 999px; padding: 0 6px; font-size: 0.75em; font-weight: normal; color: var(--vscode-descriptionForeground); }
        .comment-content, .description { white-space: pre-wrap; word-break: break-word; }
        .description { font-family: var(--vscode-editor-font-family); }
        .reply-form, .new-comment-form { padding: 8px 10px; display: flex; gap: 6px; }
        .reply-disclosure { padding: 8px 10px; }
        .reply-disclosure > summary { cursor: pointer; color: var(--vscode-descriptionForeground); font-size: 0.85em; }
        .reply-disclosure > .reply-form { padding: 8px 0 0; }
        .new-comment-form { padding: 0; flex-direction: column; }
        textarea { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 4px 6px; font-family: inherit; font-size: inherit; resize: vertical; min-height: 32px; }
        .tool-thread textarea { min-height: var(--tool-thread-textarea-min-height); font-size: var(--tool-thread-textarea-font-size); }
        .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
        .test-summary { display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
        .test-run-list, .test-failure-list { list-style: none; padding: 0; margin: 0; }
        .test-run { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border); }
        .test-run:last-child { border-bottom: none; }
        .test-run-status { min-width: 88px; }
        .test-run-name { flex: 1; min-width: 140px; }
        .test-counts { font-size: 0.85em; color: var(--vscode-descriptionForeground); white-space: nowrap; }
        .test-note { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin: 0 0 8px; }
        .test-failure { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 8px; }
        .test-failure > summary { cursor: pointer; padding: 6px 10px; background: var(--vscode-sideBarSectionHeader-background); border-radius: 4px; display: flex; gap: 10px; align-items: center; }
        .test-failure-name { flex: 1; font-weight: 600; }
        .test-failure-meta { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
        .test-failure-body { padding: 8px 10px; }
        .test-failure-body h3 { margin: 10px 0 6px; font-size: 0.9em; }
        .test-failure-body pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-editor-font-family); font-size: 0.85em; padding: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.08)); }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .modal { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 20px; width: min(480px, 90vw); max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
        .modal h2 { margin: 0 0 16px; font-size: 1.1em; }
        .modal-field { margin-bottom: 12px; }
        .modal-field label { display: block; font-size: 0.85em; margin-bottom: 4px; color: var(--vscode-descriptionForeground); }
        .modal-field select, .modal-field textarea { width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 6px 8px; font-family: inherit; font-size: inherit; }
        .modal-field textarea { resize: vertical; min-height: 60px; }
        .modal-check { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 0.9em; }
        .modal-check input[type="checkbox"] { margin: 0; }
        .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
        .modal-wi-list { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin: 4px 0 0 24px; list-style: disc; }
        .btn-danger { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-inputValidation-errorForeground, #f48771); border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); }
        .btn-danger:hover { opacity: 0.9; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        @media (max-width: 620px) { .reply-form { flex-direction: column; } .checks-list li { align-items: flex-start; flex-direction: column; } }
    `;
  customElements.define("ado-pr-details-app", AdoPrDetailsApp);
})();
