
/* =============================
   modal-no-anim.js (UMD)
   - 애니메이션/트랜지션 없이 즉시 열림/닫힘
   - 전역 window.Modal (AMD/CommonJS 지원)
   ============================= */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Modal = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class Modal {
    /**
     * @param {Object} options
     * @param {'sm'|'md'|'lg'} [options.size='md']
     * @param {string|Node} [options.title='']
     * @param {boolean} [options.closeOnEsc=true]
     * @param {boolean} [options.closeOnOverlay=true]
     * @param {boolean} [options.restoreFocus=true]
     * @param {(modal: Modal)=>void} [options.onOpen]
     * @param {(modal: Modal)=>void} [options.onClose]
     */
    constructor(options = {}) {
      this.opts = Object.assign({
        size: 'md',
        title: '',
        closeOnEsc: true,
        closeOnOverlay: true,
        restoreFocus: true,
        onOpen: null,
        onClose: null,
      }, options);
      this.isOpen = false;
      this.modal = null;
      this._build();
    }

    _build(){
      // 컨테이너
      this.el = document.createElement('div');
      this.el.className = 'mm-modal';
      this.el.setAttribute('role', 'dialog');
      this.el.setAttribute('aria-modal', 'true');
      this.el.setAttribute('aria-hidden', 'true');

      // 오버레이
      this.overlay = document.createElement('div');
      this.overlay.className = 'mm-overlay';
      if (this.opts.closeOnOverlay) {
        this.overlay.addEventListener('click', () => this.close());
      }

      // 패널
      this.panel = document.createElement('div');
      this.panel.className = `mm-panel mm-size-${this.opts.size}`;
      this.panel.setAttribute('role', 'document');

      // 헤더
      this.header = document.createElement('header');
      this.header.className = 'mm-header';
          
      this.titleEl = document.createElement('h3');
      this.titleEl.className = 'mm-title';
      this.titleEl.innerHTML = this.opts.title || '';
          
          /*
      this.closeBtn = document.createElement('button');
      this.closeBtn.className = 'mm-close';
      this.closeBtn.setAttribute('aria-label', '닫기');
      this.closeBtn.type = 'button';
      this.closeBtn.innerHTML = '✕';
      this.closeBtn.addEventListener('click', () => this.close());

      this.header.append(this.titleEl, this.closeBtn);
          */
          this.header.append(this.titleEl);

      // 바디
      this.body = document.createElement('section');
      this.body.className = 'mm-body';

      // 푸터
      this.footer = document.createElement('footer');
      this.footer.className = 'mm-footer';
      this.footer.hidden = true;

      // 트리 조립
      this.panel.append(this.header, this.body, this.footer);
      this.el.append(this.overlay, this.panel);
      document.body.appendChild(this.el);

      // 키보드 & 포커스 핸들러
      this._onKeyDown = (e) => {
        if (e.key === 'Escape' && this.opts.closeOnEsc) this.close();
        if (e.key === 'Tab') this._trapFocus(e);
      };
    }

    /** 열기 (즉시 표시) */
    open() {
      this.lastFocused = document.activeElement;
      document.body.classList.add('mm-lock');
      this.el.setAttribute('aria-hidden', 'false');
      this.isOpen = true;
      this.modal = this.el;
      // 포커스 이동 (렌더 후)
      setTimeout(() => { try { this.closeBtn.focus({ preventScroll:true }); } catch (_) {} }, 0);
      document.addEventListener('keydown', this._onKeyDown);
      if (typeof this.opts.onOpen === 'function') this.opts.onOpen(this);
    }

    /** 닫기 (즉시 숨김)
     * @param {{ destroy?: boolean }} [opts]
     */
    close(opts = {}) {
      const { destroy = true } = opts;
      this.el.setAttribute('aria-hidden', 'true');
      this.el.removeAttribute('data-state');
      document.body.classList.remove('mm-lock');
      document.removeEventListener('keydown', this._onKeyDown);
      this.isOpen = false;
      if (this.opts.restoreFocus && this.lastFocused && this.lastFocused.focus) {
        try { this.lastFocused.focus({ preventScroll: true }); } catch (_) {}
      }
      if (typeof this.opts.onClose === 'function') this.opts.onClose(this);
      if (destroy) this.destroy();
    }

    /** 내용 설정 (문자열 HTML 또는 Node) */
    setContent(content) {
      if (typeof content === 'string') {
        this.body.innerHTML = content;
      } else if (content instanceof Node) {
        this.body.replaceChildren(content);
      }
    }

    /** 타이틀 변경 */
    setTitle(title){ this.titleEl.textContent = title || ''; }

    /** 크기 변경 ('sm' | 'md' | 'lg') */
    setSize(size){
      if (!size) return;
      this.panel.classList.remove('mm-size-sm','mm-size-md','mm-size-lg');
      this.panel.classList.add(`mm-size-${size}`);
    }
        
        /** 헤더 버튼 세팅: [{ label, variant, onClick }] */
    setHeader(buttons = []){
      //this.header.replaceChildren();

      if (!buttons || buttons.length === 0) { this.header.hidden = true; return; }
      for (const btn of buttons) {
        const el = document.createElement('button');
        el.className = `mm-btn mm-close ${btn.variant || 'ghost'}`;
        el.type = 'button';
        el.textContent = btn.label || '확인';
        if (typeof btn.onClick === 'function') el.addEventListener('click', () => btn.onClick(this));
        this.header.appendChild(el);
      }
      this.header.hidden = false;
    }

    /** 푸터 버튼 세팅: [{ label, variant, onClick }] */
    setFooter(buttons = []){
      this.footer.replaceChildren();
      if (!buttons || buttons.length === 0) { this.footer.hidden = true; return; }
      for (const btn of buttons) {
        const el = document.createElement('button');
        el.className = `mm-btn ${btn.variant || 'ghost'}`;
        el.type = 'button';
        el.textContent = btn.label || '확인';
        if (typeof btn.onClick === 'function') el.addEventListener('click', () => btn.onClick(this));
        this.footer.appendChild(el);
      }
      this.footer.hidden = false;
    }

    /** 헤더 버튼 세팅 (alias) */
    setHeaderButton(buttons = []){ return this.setHeader(buttons); }
    
    /** 푸터 버튼 세팅 (alias) */
    setFooterButton(buttons = []){ return this.setFooter(buttons); }

    /** 파괴 (DOM 제거) */
    destroy(){
      document.removeEventListener('keydown', this._onKeyDown);
      if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
      this.modal = null;
    }

    /* 내부: 포커스 트랩 */
    _trapFocus(e){
      const focusables = this._getFocusable(this.el);
      if (!focusables.length) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    }

    _getFocusable(root){
      const sel = [
        'a[href]','area[href]','input:not([disabled])','select:not([disabled])','textarea:not([disabled])',
        'button:not([disabled])','iframe','object','embed','[tabindex]:not([tabindex="-1"])','[contenteditable="true"]'
      ].join(',');
      return Array.from(root.querySelectorAll(sel)).filter(n => (n.offsetParent !== null || n === document.activeElement));
    }
  }

  return Modal;
}));
