// ==UserScript==
// @name         Kleinanzeigen Ultimate Hider
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Hide ads, filter by keywords, track contacted ads - with dark mode support
// @match        *://www.kleinanzeigen.de/s-*
// @match        *://kleinanzeigen.de/s-*
// @exclude      *://www.kleinanzeigen.de/s-anzeige/*
// @exclude      *://kleinanzeigen.de/s-anzeige/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ============================================
    // 1. CONSTANTS & STORAGE KEYS
    // ============================================
    const STORAGE_KEYS = {
        HIDDEN_ADS: 'ka_hidden_ads_v3',
        CONTACTED_ADS: 'ka_contacted_ads',
        KEYWORDS: 'ka_hidden_keywords',
        SETTINGS: 'ka_settings'
    };

    const COLORS = {
        light: {
            bg: '#ffffff',
            bgSecondary: '#f8f8f8',
            bgTertiary: '#f0f0f0',
            text: '#333333',
            textSecondary: '#666666',
            textMuted: '#999999',
            border: '#e0e0e0',
            borderLight: '#eeeeee',
            primary: '#86b817',
            primaryHover: '#6a9413',
            primaryLight: '#e8f5d0',
            danger: '#e74c3c',
            dangerHover: '#c0392b',
            contactedBg: 'rgba(134, 184, 23, 0.12)',
            contactedBorder: '#86b817',
            placeholderBg: '#fafafa'
        },
        dark: {
            bg: '#1a1a1a',
            bgSecondary: '#252525',
            bgTertiary: '#333333',
            text: '#e8e8e8',
            textSecondary: '#b0b0b0',
            textMuted: '#808080',
            border: '#404040',
            borderLight: '#353535',
            primary: '#86b817',
            primaryHover: '#9ed41f',
            primaryLight: '#2d3a1a',
            danger: '#e74c3c',
            dangerHover: '#ff6b5b',
            contactedBg: 'rgba(134, 184, 23, 0.2)',
            contactedBorder: '#86b817',
            placeholderBg: '#222222'
        }
    };

    // ============================================
    // 2. STATE MANAGEMENT
    // ============================================
    let state = {
        hiddenAds: [],      // { id, title, price, location, url, category, categoryPath, hiddenAt, hiddenBy, matchedKeyword? }
        contactedAds: [],   // { id, contactedAt }
        keywords: [],       // strings
        settings: {
            darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches
        }
    };

    // Session-only whitelist for explicitly restored ads (prevents keyword re-hiding)
    const restoredAdsWhitelist = new Set();

    function loadState() {
        try {
            const hiddenRaw = localStorage.getItem(STORAGE_KEYS.HIDDEN_ADS);
            state.hiddenAds = hiddenRaw ? JSON.parse(hiddenRaw) : [];
            // Migration from old format
            state.hiddenAds = state.hiddenAds.map(ad => {
                if (typeof ad === 'string' || typeof ad === 'number') {
                    return { id: String(ad), title: '(Unbekannt)', price: '', location: '', url: '#', category: 'Unbekannt', categoryPath: '', hiddenAt: Date.now(), hiddenBy: 'manual' };
                }
                return ad;
            });
        } catch (e) { state.hiddenAds = []; }

        try {
            const contactedRaw = localStorage.getItem(STORAGE_KEYS.CONTACTED_ADS);
            state.contactedAds = contactedRaw ? JSON.parse(contactedRaw) : [];
        } catch (e) { state.contactedAds = []; }

        try {
            const keywordsRaw = localStorage.getItem(STORAGE_KEYS.KEYWORDS);
            state.keywords = keywordsRaw ? JSON.parse(keywordsRaw) : [];
        } catch (e) { state.keywords = []; }

        try {
            const settingsRaw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
            if (settingsRaw) {
                state.settings = { ...state.settings, ...JSON.parse(settingsRaw) };
            }
        } catch (e) { /* keep defaults */ }
    }

    function saveHiddenAds() {
        localStorage.setItem(STORAGE_KEYS.HIDDEN_ADS, JSON.stringify(state.hiddenAds));
    }

    function saveContactedAds() {
        localStorage.setItem(STORAGE_KEYS.CONTACTED_ADS, JSON.stringify(state.contactedAds));
    }

    function saveKeywords() {
        localStorage.setItem(STORAGE_KEYS.KEYWORDS, JSON.stringify(state.keywords));
    }

    function saveSettings() {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
    }

    // ============================================
    // 3. HELPER FUNCTIONS
    // ============================================
    function getAdIdFromLink(href) {
        if (!href) return null;
        const match = href.match(/\/(\d+)-\d+-\d+$/);
        return match ? match[1] : null;
    }

    function isHidden(adId) {
        return state.hiddenAds.some(a => a.id === adId);
    }

    function isContacted(adId) {
        return state.contactedAds.some(a => a.id === adId);
    }

    function extractCategory() {
        const breadcrumbs = document.querySelectorAll('.breadcrump a');
        const categories = Array.from(breadcrumbs).map(a => a.textContent.trim()).filter(Boolean);

        const pathMatch = location.pathname.match(/\/s-([^/]+)/);
        const categoryPath = pathMatch ? pathMatch[1] : 'unknown';

        return {
            display: categories.length > 0 ? categories.join(' / ') : categoryPath.replace(/-/g, ' '),
            path: categoryPath
        };
    }

    function getColors() {
        return state.settings.darkMode ? COLORS.dark : COLORS.light;
    }

    function getAdContainers() {
        // Try old selectors first
        let containers = document.querySelectorAll('li.ad-listitem, article.aditem');
        if (containers.length > 0) return containers;

        // Fallback for new Tailwind-based design: find li elements containing ad links
        const allLis = document.querySelectorAll('#srchrslt-adtable li, [id*="srchrslt"] li');
        const adLis = Array.from(allLis).filter(li =>
            li.querySelector('a[href*="/s-anzeige/"]') &&
            li.querySelector('article')
        );
        return adLis;
    }

    function extractAdData(container) {
        const link = container.querySelector('a[href*="/s-anzeige/"]');
        if (!link) return null;

        const href = link.getAttribute('href');
        const id = getAdIdFromLink(href);
        if (!id) return null;

        // Old design selectors
        let titleEl = container.querySelector('.aditem-main--middle--title') ||
                      container.querySelector('a.ellipsis');
        // New design: title is in h2, h3, or the first link with ad URL
        if (!titleEl) {
            titleEl = container.querySelector('h2 a[href*="/s-anzeige/"]') ||
                      container.querySelector('h3 a[href*="/s-anzeige/"]') ||
                      container.querySelector('h2') ||
                      container.querySelector('h3') ||
                      link;
        }

        // Old design selectors
        let priceEl = container.querySelector('.aditem-main--middle--price-shipping') ||
                      container.querySelector('.aditem-main--middle--price');
        // New design: look for price pattern (number followed by €)
        if (!priceEl) {
            const allText = container.querySelectorAll('p, span, div');
            for (const el of allText) {
                if (/\d+\s*€/.test(el.textContent) && el.textContent.length < 50) {
                    priceEl = el;
                    break;
                }
            }
        }

        // Old design selector
        let locationEl = container.querySelector('.aditem-main--top--left');
        // New design: location usually contains postal code (5 digits)
        if (!locationEl) {
            const allText = container.querySelectorAll('p, span, div');
            for (const el of allText) {
                if (/\d{5}/.test(el.textContent) && el.textContent.length < 100) {
                    locationEl = el;
                    break;
                }
            }
        }

        const title = titleEl?.textContent?.trim() || '(Kein Titel)';
        const price = priceEl?.textContent?.trim() || '';
        const adLocation = locationEl?.textContent?.trim().replace(/\s+/g, ' ') || '';

        // Extract only the /s-anzeige/ portion to avoid search context in URL
        const anzeigenMatch = href.match(/(\/s-anzeige\/.+)$/);
        const cleanHref = anzeigenMatch ? anzeigenMatch[1] : href;
        const url = cleanHref.startsWith('http') ? cleanHref : window.location.origin + cleanHref;

        const category = extractCategory();

        return { id, title, price, location: adLocation, url, category: category.display, categoryPath: category.path };
    }

    // ============================================
    // 4. CSS INJECTION
    // ============================================
    function injectStyles() {
        const styleId = 'ka-hider-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* Hide empty ad placeholder slots */
            #srchrslt-adtable li:has([data-liberty-position-name]),
            li.ad-listitem:has([data-liberty-position-name]),
            [data-liberty-position-name] {
                display: none !important;
            }

            /* Button styles */
            .ka-btn-group {
                position: absolute;
                top: 8px;
                right: 8px;
                display: flex;
                gap: 4px;
                z-index: 100;
                opacity: 0;
                transition: opacity 0.2s ease;
            }

            .ad-listitem:hover .ka-btn-group,
            article.aditem:hover .ka-btn-group,
            #srchrslt-adtable li:hover .ka-btn-group,
            li:has(article):hover .ka-btn-group {
                opacity: 1;
            }

            .ka-btn {
                width: 32px;
                height: 32px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                border: none;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }

            .ka-btn-contacted {
                background: white;
                color: #666;
            }

            .ka-btn-contacted:hover {
                background: #e8f5d0;
                color: #86b817;
            }

            .ka-btn-contacted.active {
                background: #86b817;
                color: white;
            }

            .ka-btn-hide {
                background: white;
                color: #666;
            }

            .ka-btn-hide:hover {
                background: #fee;
                color: #e74c3c;
            }

            /* Contacted ad overlay */
            .ka-contacted {
                background: linear-gradient(to right, rgba(134, 184, 23, 0.12), rgba(134, 184, 23, 0.06)) !important;
                border-left: 3px solid #86b817 !important;
            }

            /* Hidden ad placeholder */
            .ka-placeholder {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                margin: 4px 0;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .ka-placeholder:hover {
                transform: translateX(4px);
            }

            .ka-placeholder-content {
                display: flex;
                align-items: center;
                gap: 12px;
                flex: 1;
                min-width: 0;
            }

            .ka-placeholder-icon {
                font-size: 18px;
                opacity: 0.5;
            }

            .ka-placeholder-info {
                display: flex;
                flex-direction: column;
                gap: 2px;
                min-width: 0;
            }

            .ka-placeholder-title {
                font-size: 13px;
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .ka-placeholder-meta {
                font-size: 11px;
                display: flex;
                gap: 8px;
            }

            .ka-placeholder-restore {
                padding: 6px 12px;
                border-radius: 4px;
                border: none;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s ease;
            }

            /* Panel styles */
            .ka-panel {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 99999;
                width: 340px;
                max-height: 70vh;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.15);
                display: none;
                flex-direction: column;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 13px;
                overflow: hidden;
            }

            .ka-panel-header {
                padding: 14px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid;
            }

            .ka-panel-title {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 600;
                font-size: 14px;
            }

            .ka-panel-actions {
                display: flex;
                gap: 8px;
            }

            .ka-panel-btn {
                width: 28px;
                height: 28px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
                transition: all 0.2s ease;
            }

            .ka-panel-content {
                flex: 1;
                overflow-y: auto;
                overflow-x: hidden;
                padding: 16px;
            }

            .ka-panel-section {
                margin-bottom: 16px;
            }

            .ka-panel-section:last-child {
                margin-bottom: 0;
            }

            .ka-panel-section-title {
                font-weight: 600;
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 10px;
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .ka-keyword-input-wrap {
                display: flex;
                gap: 6px;
                margin-bottom: 10px;
            }

            .ka-keyword-input {
                flex: 1;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 13px;
                outline: none;
                transition: border-color 0.2s;
            }

            .ka-keyword-input:focus {
                border-color: #86b817;
            }

            .ka-keyword-add-btn {
                padding: 8px 14px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 600;
                transition: all 0.2s ease;
            }

            .ka-keyword-tags {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }

            .ka-keyword-tag {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 4px 10px;
                border-radius: 20px;
                font-size: 12px;
            }

            .ka-keyword-tag-remove {
                cursor: pointer;
                opacity: 0.7;
                transition: opacity 0.2s;
            }

            .ka-keyword-tag-remove:hover {
                opacity: 1;
            }

            .ka-category-group {
                margin-bottom: 12px;
            }

            .ka-category-header {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 8px 0;
                cursor: pointer;
                font-weight: 500;
                font-size: 12px;
            }

            .ka-category-header:hover {
                opacity: 0.8;
            }

            .ka-category-items {
                padding-left: 16px;
            }

            .ka-hidden-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid;
            }

            .ka-hidden-item:last-child {
                border-bottom: none;
            }

            .ka-hidden-item-info {
                flex: 1;
                min-width: 0;
            }

            .ka-hidden-item-title {
                font-size: 12px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                cursor: pointer;
                text-decoration: none;
                display: block;
                max-width: 230px;
            }

            .ka-hidden-item-title:hover {
                text-decoration: underline;
            }

            .ka-hidden-item-meta {
                font-size: 10px;
                margin-top: 2px;
            }

            .ka-hidden-item-restore {
                padding: 4px 8px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                margin-left: 8px;
                transition: all 0.2s ease;
            }

            .ka-panel-footer {
                padding: 12px 16px;
                border-top: 1px solid;
            }

            .ka-reset-btn {
                width: 100%;
                padding: 10px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 500;
                transition: all 0.2s ease;
            }

            /* Toggle button */
            .ka-toggle-btn {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 99998;
                padding: 12px 18px;
                border-radius: 30px;
                cursor: pointer;
                font-weight: 600;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                transition: all 0.2s ease;
                border: none;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }

            .ka-toggle-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 16px rgba(0,0,0,0.2);
            }

            .ka-stat-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 18px;
                height: 18px;
                padding: 0 6px;
                border-radius: 9px;
                font-size: 11px;
                font-weight: 600;
            }

            .ka-empty-state {
                text-align: center;
                padding: 20px;
                font-style: italic;
                opacity: 0.6;
            }

            /* Dark mode overrides */
            body.ka-dark-mode .ka-btn-contacted {
                background: #333;
                color: #aaa;
            }

            body.ka-dark-mode .ka-btn-contacted:hover {
                background: #2d3a1a;
                color: #86b817;
            }

            body.ka-dark-mode .ka-btn-hide {
                background: #333;
                color: #aaa;
            }

            body.ka-dark-mode .ka-btn-hide:hover {
                background: #3a2020;
                color: #e74c3c;
            }

            body.ka-dark-mode .ka-contacted {
                background: linear-gradient(to right, rgba(134, 184, 23, 0.2), rgba(134, 184, 23, 0.1)) !important;
            }
        `;
        document.head.appendChild(style);
    }

    // ============================================
    // 5. UI CREATION
    // ============================================
    let ui = {
        panel: null,
        toggleBtn: null,
        keywordInput: null,
        keywordTags: null,
        hiddenList: null,
        contactedCount: null,
        hiddenCount: null,
        darkModeBtn: null,
        closeTimeout: null
    };

    function createUI() {
        if (document.getElementById('ka-panel')) return;

        const colors = getColors();

        // Toggle Button
        ui.toggleBtn = document.createElement('button');
        ui.toggleBtn.className = 'ka-toggle-btn';
        ui.toggleBtn.style.background = colors.primary;
        ui.toggleBtn.style.color = 'white';
        updateToggleButton();
        document.body.appendChild(ui.toggleBtn);

        // Main Panel
        ui.panel = document.createElement('div');
        ui.panel.id = 'ka-panel';
        ui.panel.className = 'ka-panel';
        applyPanelColors();

        // Header
        const header = document.createElement('div');
        header.className = 'ka-panel-header';
        header.innerHTML = `
            <div class="ka-panel-title">
                <span>Filter</span>
            </div>
            <div class="ka-panel-actions"></div>
        `;

        const actions = header.querySelector('.ka-panel-actions');

        // Dark mode toggle
        ui.darkModeBtn = document.createElement('button');
        ui.darkModeBtn.className = 'ka-panel-btn';
        ui.darkModeBtn.title = 'Dark Mode umschalten';
        ui.darkModeBtn.textContent = state.settings.darkMode ? '☀️' : '🌙';
        ui.darkModeBtn.onclick = toggleDarkMode;
        actions.appendChild(ui.darkModeBtn);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ka-panel-btn';
        closeBtn.textContent = '✕';
        closeBtn.title = 'Schließen';
        closeBtn.onclick = () => hidePanel();
        actions.appendChild(closeBtn);

        ui.panel.appendChild(header);

        // Content
        const content = document.createElement('div');
        content.className = 'ka-panel-content';

        // Keywords Section
        const keywordsSection = document.createElement('div');
        keywordsSection.className = 'ka-panel-section';
        keywordsSection.innerHTML = `
            <div class="ka-panel-section-title">
                <span>🔍</span>
                <span>Keywords (Auto-Hide)</span>
            </div>
        `;

        const keywordInputWrap = document.createElement('div');
        keywordInputWrap.className = 'ka-keyword-input-wrap';

        ui.keywordInput = document.createElement('input');
        ui.keywordInput.className = 'ka-keyword-input';
        ui.keywordInput.type = 'text';
        ui.keywordInput.placeholder = 'z.B. Tauschwohnung';
        ui.keywordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') addKeyword();
        });

        const addBtn = document.createElement('button');
        addBtn.className = 'ka-keyword-add-btn';
        addBtn.textContent = '+';
        addBtn.onclick = addKeyword;

        keywordInputWrap.appendChild(ui.keywordInput);
        keywordInputWrap.appendChild(addBtn);
        keywordsSection.appendChild(keywordInputWrap);

        ui.keywordTags = document.createElement('div');
        ui.keywordTags.className = 'ka-keyword-tags';
        keywordsSection.appendChild(ui.keywordTags);

        content.appendChild(keywordsSection);

        // Contacted Section
        const contactedSection = document.createElement('div');
        contactedSection.className = 'ka-panel-section';
        contactedSection.innerHTML = `
            <div class="ka-panel-section-title">
                <span>📧</span>
                <span>Kontaktiert</span>
                <span class="ka-stat-badge" id="ka-contacted-count">0</span>
            </div>
        `;
        content.appendChild(contactedSection);

        // Hidden Ads Section
        const hiddenSection = document.createElement('div');
        hiddenSection.className = 'ka-panel-section';
        hiddenSection.innerHTML = `
            <div class="ka-panel-section-title">
                <span>👁</span>
                <span>Versteckte Anzeigen</span>
                <span class="ka-stat-badge" id="ka-hidden-count">0</span>
            </div>
        `;

        ui.hiddenList = document.createElement('div');
        ui.hiddenList.id = 'ka-hidden-list';
        hiddenSection.appendChild(ui.hiddenList);

        content.appendChild(hiddenSection);
        ui.panel.appendChild(content);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'ka-panel-footer';

        const resetBtn = document.createElement('button');
        resetBtn.className = 'ka-reset-btn';
        resetBtn.textContent = 'Alle versteckten Anzeigen wiederherstellen';
        resetBtn.onclick = () => {
            if (confirm('Wirklich alle versteckten Anzeigen wiederherstellen?')) {
                state.hiddenAds = [];
                saveHiddenAds();
                applyFilters();
                updateHiddenList();
                updateCounts();
            }
        };
        footer.appendChild(resetBtn);

        ui.panel.appendChild(footer);
        document.body.appendChild(ui.panel);

        // Get count elements
        ui.contactedCount = document.getElementById('ka-contacted-count');
        ui.hiddenCount = document.getElementById('ka-hidden-count');

        // Hover behavior
        ui.toggleBtn.addEventListener('mouseenter', () => {
            clearTimeout(ui.closeTimeout);
            showPanel();
        });

        ui.panel.addEventListener('mouseenter', () => {
            clearTimeout(ui.closeTimeout);
        });

        ui.panel.addEventListener('mouseleave', () => {
            ui.closeTimeout = setTimeout(() => {
                hidePanel();
            }, 300);
        });

        ui.toggleBtn.addEventListener('mouseleave', () => {
            ui.closeTimeout = setTimeout(() => {
                if (!ui.panel.matches(':hover')) {
                    hidePanel();
                }
            }, 300);
        });

        // Initial render
        renderKeywords();
        updateHiddenList();
        updateCounts();
        applyColors();
    }

    function showPanel() {
        ui.panel.style.display = 'flex';
        ui.toggleBtn.style.display = 'none';
    }

    function hidePanel() {
        ui.panel.style.display = 'none';
        ui.toggleBtn.style.display = 'flex';
    }

    function updateToggleButton() {
        const hiddenCount = state.hiddenAds.length;
        const contactedCount = state.contactedAds.length;
        ui.toggleBtn.innerHTML = `
            <span>🔍</span>
            <span>Filter</span>
            ${hiddenCount > 0 ? `<span class="ka-stat-badge" style="background: rgba(255,255,255,0.2);">${hiddenCount}</span>` : ''}
        `;
    }

    function applyPanelColors() {
        const colors = getColors();
        ui.panel.style.background = colors.bg;
        ui.panel.style.color = colors.text;
        ui.panel.style.border = `1px solid ${colors.border}`;
    }

    function applyColors() {
        const colors = getColors();

        // Panel
        if (ui.panel) {
            ui.panel.style.background = colors.bg;
            ui.panel.style.color = colors.text;

            // Header
            const header = ui.panel.querySelector('.ka-panel-header');
            if (header) {
                header.style.background = colors.bgSecondary;
                header.style.borderColor = colors.border;
            }

            // Panel buttons
            ui.panel.querySelectorAll('.ka-panel-btn').forEach(btn => {
                btn.style.background = colors.bgTertiary;
                btn.style.color = colors.text;
            });

            // Input
            if (ui.keywordInput) {
                ui.keywordInput.style.background = colors.bgSecondary;
                ui.keywordInput.style.color = colors.text;
                ui.keywordInput.style.border = `1px solid ${colors.border}`;
            }

            // Add button
            const addBtn = ui.panel.querySelector('.ka-keyword-add-btn');
            if (addBtn) {
                addBtn.style.background = colors.primary;
                addBtn.style.color = 'white';
            }

            // Keywords
            ui.panel.querySelectorAll('.ka-keyword-tag').forEach(tag => {
                tag.style.background = colors.primaryLight;
                tag.style.color = colors.text;
            });

            // Stat badges
            ui.panel.querySelectorAll('.ka-stat-badge').forEach(badge => {
                badge.style.background = colors.bgTertiary;
                badge.style.color = colors.textSecondary;
            });

            // Hidden items
            ui.panel.querySelectorAll('.ka-hidden-item').forEach(item => {
                item.style.borderColor = colors.borderLight;
            });

            ui.panel.querySelectorAll('.ka-hidden-item-title').forEach(title => {
                title.style.color = colors.primary;
            });

            ui.panel.querySelectorAll('.ka-hidden-item-meta').forEach(meta => {
                meta.style.color = colors.textMuted;
            });

            ui.panel.querySelectorAll('.ka-hidden-item-restore').forEach(btn => {
                btn.style.background = colors.bgTertiary;
                btn.style.color = colors.text;
            });

            // Footer
            const footer = ui.panel.querySelector('.ka-panel-footer');
            if (footer) {
                footer.style.borderColor = colors.border;
                footer.style.background = colors.bgSecondary;
            }

            // Reset button
            const resetBtn = ui.panel.querySelector('.ka-reset-btn');
            if (resetBtn) {
                resetBtn.style.background = colors.danger;
                resetBtn.style.color = 'white';
            }

            // Category headers
            ui.panel.querySelectorAll('.ka-category-header').forEach(header => {
                header.style.color = colors.textSecondary;
            });
        }

        // Toggle button
        if (ui.toggleBtn) {
            ui.toggleBtn.style.background = colors.primary;
        }

        // Placeholders on page
        document.querySelectorAll('.ka-placeholder').forEach(ph => {
            ph.style.background = colors.placeholderBg;
            ph.style.border = `1px solid ${colors.border}`;
        });

        document.querySelectorAll('.ka-placeholder-title').forEach(el => {
            el.style.color = colors.text;
        });

        document.querySelectorAll('.ka-placeholder-meta').forEach(el => {
            el.style.color = colors.textMuted;
        });

        document.querySelectorAll('.ka-placeholder-restore').forEach(btn => {
            btn.style.background = colors.primary;
            btn.style.color = 'white';
        });

        // Dark mode class on body
        if (state.settings.darkMode) {
            document.body.classList.add('ka-dark-mode');
        } else {
            document.body.classList.remove('ka-dark-mode');
        }
    }

    function toggleDarkMode() {
        state.settings.darkMode = !state.settings.darkMode;
        saveSettings();
        ui.darkModeBtn.textContent = state.settings.darkMode ? '☀️' : '🌙';
        applyColors();
    }

    // ============================================
    // 6. KEYWORD MANAGEMENT
    // ============================================
    function addKeyword() {
        const val = ui.keywordInput.value.trim().toLowerCase();
        if (val && !state.keywords.includes(val)) {
            state.keywords.push(val);
            saveKeywords();
            ui.keywordInput.value = '';
            renderKeywords();
            applyFilters();
        }
    }

    function removeKeyword(kw) {
        state.keywords = state.keywords.filter(k => k !== kw);
        saveKeywords();
        renderKeywords();
    }

    function renderKeywords() {
        if (!ui.keywordTags) return;
        const colors = getColors();

        ui.keywordTags.innerHTML = '';
        state.keywords.forEach(kw => {
            const tag = document.createElement('span');
            tag.className = 'ka-keyword-tag';
            tag.style.background = colors.primaryLight;
            tag.style.color = colors.text;
            tag.innerHTML = `
                <span>${kw}</span>
                <span class="ka-keyword-tag-remove">✕</span>
            `;
            tag.querySelector('.ka-keyword-tag-remove').onclick = () => removeKeyword(kw);
            ui.keywordTags.appendChild(tag);
        });
    }

    // ============================================
    // 7. HIDDEN ADS LIST
    // ============================================
    function updateHiddenList() {
        if (!ui.hiddenList) return;
        const colors = getColors();

        ui.hiddenList.innerHTML = '';

        if (state.hiddenAds.length === 0) {
            ui.hiddenList.innerHTML = '<div class="ka-empty-state">Keine versteckten Anzeigen</div>';
            return;
        }

        // Group by category
        const grouped = {};
        state.hiddenAds.forEach(ad => {
            const cat = ad.category || 'Unbekannt';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(ad);
        });

        Object.keys(grouped).sort().forEach(category => {
            const group = document.createElement('div');
            group.className = 'ka-category-group';

            const header = document.createElement('div');
            header.className = 'ka-category-header';
            header.style.color = colors.textSecondary;
            header.innerHTML = `
                <span class="ka-category-toggle">▼</span>
                <span>${category} (${grouped[category].length})</span>
            `;

            let expanded = true;
            const items = document.createElement('div');
            items.className = 'ka-category-items';

            header.onclick = () => {
                expanded = !expanded;
                items.style.display = expanded ? 'block' : 'none';
                header.querySelector('.ka-category-toggle').textContent = expanded ? '▼' : '▶';
            };

            grouped[category].reverse().forEach(ad => {
                const item = document.createElement('div');
                item.className = 'ka-hidden-item';
                item.style.borderColor = colors.borderLight;

                const info = document.createElement('div');
                info.className = 'ka-hidden-item-info';

                const title = document.createElement('a');
                title.className = 'ka-hidden-item-title';
                // Clean URL to extract only /s-anzeige/ portion (fixes old stored URLs)
                const urlMatch = ad.url?.match(/(\/s-anzeige\/.+)$/);
                title.href = urlMatch ? window.location.origin + urlMatch[1] : ad.url;
                title.target = '_blank';
                title.textContent = ad.title;
                title.title = ad.title; // Tooltip on hover
                title.style.color = colors.primary;

                const meta = document.createElement('div');
                meta.className = 'ka-hidden-item-meta';
                meta.style.color = colors.textMuted;
                meta.textContent = [ad.price, ad.location].filter(Boolean).join(' • ');

                info.appendChild(title);
                info.appendChild(meta);

                const restoreBtn = document.createElement('button');
                restoreBtn.className = 'ka-hidden-item-restore';
                restoreBtn.style.background = colors.bgTertiary;
                restoreBtn.style.color = colors.text;
                restoreBtn.textContent = '↺';
                restoreBtn.title = 'Wiederherstellen';
                restoreBtn.onclick = () => restoreAd(ad.id);

                item.appendChild(info);
                item.appendChild(restoreBtn);
                items.appendChild(item);
            });

            group.appendChild(header);
            group.appendChild(items);
            ui.hiddenList.appendChild(group);
        });
    }

    function updateCounts() {
        if (ui.contactedCount) {
            ui.contactedCount.textContent = state.contactedAds.length;
        }
        if (ui.hiddenCount) {
            ui.hiddenCount.textContent = state.hiddenAds.length;
        }
        updateToggleButton();
    }

    // ============================================
    // 8. CORE LOGIC
    // ============================================
    function hideAd(adId, adData) {
        if (isHidden(adId)) return;

        state.hiddenAds.push({
            id: adId,
            title: adData.title,
            price: adData.price,
            location: adData.location,
            url: adData.url,
            category: adData.category,
            categoryPath: adData.categoryPath,
            hiddenAt: Date.now(),
            hiddenBy: 'manual'
        });
        saveHiddenAds();
        applyFilters();
        updateHiddenList();
        updateCounts();
    }

    function hideAdByKeyword(adId, adData, keyword) {
        if (isHidden(adId)) return;

        state.hiddenAds.push({
            id: adId,
            title: adData.title,
            price: adData.price,
            location: adData.location,
            url: adData.url,
            category: adData.category,
            categoryPath: adData.categoryPath,
            hiddenAt: Date.now(),
            hiddenBy: 'keyword',
            matchedKeyword: keyword
        });
        saveHiddenAds();
    }

    function restoreAd(adId) {
        // Remove from hidden ads state
        state.hiddenAds = state.hiddenAds.filter(a => a.id !== adId);
        saveHiddenAds();

        // Add to whitelist to prevent keyword re-hiding
        restoredAdsWhitelist.add(adId);

        // Find and remove all placeholders for this ad, show original containers
        document.querySelectorAll(`.ka-placeholder[data-ad-id="${adId}"]`).forEach(placeholder => {
            // The original container is the next sibling (placeholder was inserted before it)
            const nextSibling = placeholder.nextElementSibling;
            // Check for both old classes and new design (li with article containing ad link)
            const isAdContainer = nextSibling && (
                nextSibling.matches('li.ad-listitem') ||
                nextSibling.matches('article.aditem') ||
                (nextSibling.matches('li') && nextSibling.querySelector('a[href*="/s-anzeige/"]'))
            );
            if (isAdContainer) {
                nextSibling.style.display = '';
                const adData = extractAdData(nextSibling);
                if (adData) {
                    addAdButtons(nextSibling, adId, adData);
                }
            }
            placeholder.remove();
        });

        updateHiddenList();
        updateCounts();
    }

    function toggleContacted(adId, container) {
        if (isContacted(adId)) {
            state.contactedAds = state.contactedAds.filter(a => a.id !== adId);
            container.classList.remove('ka-contacted');
            const btn = container.querySelector('.ka-btn-contacted');
            if (btn) {
                btn.classList.remove('active');
                btn.textContent = '📧';
            }
        } else {
            state.contactedAds.push({ id: adId, contactedAt: Date.now() });
            container.classList.add('ka-contacted');
            const btn = container.querySelector('.ka-btn-contacted');
            if (btn) {
                btn.classList.add('active');
                btn.textContent = '✉️';
            }
        }
        saveContactedAds();
        updateCounts();
    }

    function createPlaceholder(adData, originalContainer) {
        const colors = getColors();
        const placeholder = document.createElement('div');
        placeholder.className = 'ka-placeholder';
        placeholder.dataset.adId = adData.id;
        placeholder.style.background = colors.placeholderBg;
        placeholder.style.border = `1px solid ${colors.border}`;

        placeholder.innerHTML = `
            <div class="ka-placeholder-content">
                <span class="ka-placeholder-icon">👁‍🗨</span>
                <div class="ka-placeholder-info">
                    <div class="ka-placeholder-title" style="color: ${colors.text};">${adData.title}</div>
                    <div class="ka-placeholder-meta" style="color: ${colors.textMuted};">
                        ${[adData.price, adData.location].filter(Boolean).join(' • ')}
                    </div>
                </div>
            </div>
        `;

        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'ka-placeholder-restore';
        restoreBtn.style.background = colors.primary;
        restoreBtn.style.color = 'white';
        restoreBtn.textContent = '↺';
        restoreBtn.title = 'Wiederherstellen';
        restoreBtn.onclick = (e) => {
            e.stopPropagation();
            restoreAd(adData.id);
        };

        placeholder.appendChild(restoreBtn);

        // Click to open ad
        placeholder.querySelector('.ka-placeholder-content').onclick = () => {
            window.open(adData.url, '_blank');
        };
        placeholder.querySelector('.ka-placeholder-content').style.cursor = 'pointer';

        return placeholder;
    }

    function addAdButtons(container, adId, adData) {
        if (container.querySelector('.ka-btn-group')) return;

        const btnGroup = document.createElement('div');
        btnGroup.className = 'ka-btn-group';

        // Contacted button
        const contactedBtn = document.createElement('button');
        contactedBtn.className = 'ka-btn ka-btn-contacted' + (isContacted(adId) ? ' active' : '');
        contactedBtn.textContent = isContacted(adId) ? '✉️' : '📧';
        contactedBtn.title = 'Als kontaktiert markieren';
        contactedBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleContacted(adId, container);
        };

        // Hide button
        const hideBtn = document.createElement('button');
        hideBtn.className = 'ka-btn ka-btn-hide';
        hideBtn.textContent = '👁';
        hideBtn.title = 'Anzeige verstecken';
        hideBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            hideAd(adId, adData);
        };

        btnGroup.appendChild(contactedBtn);
        btnGroup.appendChild(hideBtn);

        container.style.position = 'relative';
        container.appendChild(btnGroup);

        // Apply contacted styling if needed
        if (isContacted(adId)) {
            container.classList.add('ka-contacted');
        }
    }

    function applyFilters() {
        const adContainers = getAdContainers();

        adContainers.forEach(container => {
            // Skip if already processed as placeholder
            if (container.classList.contains('ka-placeholder')) return;

            const adData = extractAdData(container);
            if (!adData) return;

            const { id } = adData;

            // Check if hidden
            if (isHidden(id)) {
                // Replace with placeholder if not already
                let placeholder = container.parentNode.querySelector(`.ka-placeholder[data-ad-id="${id}"]`);
                if (!placeholder) {
                    // Get stored hidden ad data to check if it was hidden by keyword
                    const hiddenAdData = state.hiddenAds.find(a => a.id === id);
                    let placeholderData = adData;
                    if (hiddenAdData && hiddenAdData.hiddenBy === 'keyword' && hiddenAdData.matchedKeyword) {
                        placeholderData = { ...adData, title: `${adData.title} (${hiddenAdData.matchedKeyword})` };
                    }
                    placeholder = createPlaceholder(placeholderData, container);
                    container.parentNode.insertBefore(placeholder, container);
                }
                container.style.display = 'none';
                return;
            }

            // Check keywords - only in title and description to avoid false positives
            // Skip keyword check for explicitly restored ads
            if (!restoredAdsWhitelist.has(id)) {
                const titleText = adData.title.toLowerCase();
                // Try old selector first, then fall back to all paragraphs for new design
                let descEl = container.querySelector('.aditem-main--middle--description, [class*="description"]');
                let descText = '';
                if (descEl) {
                    descText = descEl.textContent.toLowerCase();
                } else {
                    // New design: collect text from all paragraphs
                    const paragraphs = container.querySelectorAll('p');
                    descText = Array.from(paragraphs).map(p => p.textContent).join(' ').toLowerCase();
                }
                const searchText = `${titleText} ${descText}`;
                const matchedKeyword = state.keywords.find(kw => searchText.includes(kw));
                if (matchedKeyword) {
                    hideAdByKeyword(id, adData, matchedKeyword);
                    // Only create placeholder if one doesn't exist
                    let placeholder = container.parentNode.querySelector(`.ka-placeholder[data-ad-id="${id}"]`);
                    if (!placeholder) {
                        placeholder = createPlaceholder({ ...adData, title: `${adData.title} (${matchedKeyword})` }, container);
                        container.parentNode.insertBefore(placeholder, container);
                    }
                    container.style.display = 'none';
                    updateHiddenList();
                    updateCounts();
                    return;
                }
            }

            // Not hidden - show and add buttons
            container.style.display = '';

            // Remove any existing placeholder
            const existingPlaceholder = container.parentNode.querySelector(`.ka-placeholder[data-ad-id="${id}"]`);
            if (existingPlaceholder) {
                existingPlaceholder.remove();
            }

            // Add buttons
            addAdButtons(container, id, adData);
        });
    }

    // ============================================
    // 9. INITIALIZATION
    // ============================================
    function init() {
        loadState();
        injectStyles();
        createUI();
        applyFilters();

        // Observer for dynamic content
        const observer = new MutationObserver(() => {
            applyFilters();
        });

        const targetNode = document.querySelector('#srchrslt-adtable') ||
                          document.querySelector('[class*="adlist"]') ||
                          document.body;
        observer.observe(targetNode, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
