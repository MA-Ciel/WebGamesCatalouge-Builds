/**
 * =========================================================================
 * CIEL WEBGL GAME COMMUNICATION & ADS BRIDGE (game-bridge.js)
 * =========================================================================
 * Ye file Unity WebGL game aur Website k darmian communication k liye hai.
 * This script manages two-way communication between Unity and your Website:
 * 1. Website -> Unity (Send messages, trigger actions, grant rewards, pause/resume)
 * 2. Unity -> Website (Receive ad requests, game events, score updates, callbacks)
 * 3. Google H5 Games Ads / Ad Placement API (adBreak) + Fallback Preview Modal
 * =========================================================================
 */

(function(window) {
  'use strict';

  // Google AdSense / H5 Ads queue initialization
  window.adsbygoogle = window.adsbygoogle || [];
  window.adBreak = (window.adConfig = function(o) { window.adsbygoogle.push(o); });

  const GameBridge = {
    // Reference to the active Unity instance
    unityInstance: null,

    // Default target GameObject name in Unity hierarchy
    defaultTarget: "[AdManager]",

    // Ad & Environment Configuration
    config: {
      // Set to 'false' when using live approved Google AdSense publisher ID
      // When 'true', opens the built-in testing modal with countdown & reward buttons
      testMode: true,
      googlePublisherId: "ca-pub-0000000000000000",
      interstitialDuration: 4, // seconds
      rewardedDuration: 5,     // seconds
      debugLogs: true,

      // How long to wait after window.close() before deciding the browser
      // refused it and showing the "Game Ended" popup instead.
      closeAttemptTimeout: 400,

      // How long to wait for a host portal to acknowledge GAME_ENDED
      gameEndAckTimeout: 800,

      // Copy for the "Do you want to exit?" dialog. Change it here.
      exitConfirmTitle: "Exit Game?",
      exitConfirmMessage: "Do you want to exit? Your progress in this round may be lost.",
      exitConfirmYes: "Yes, Exit",
      exitConfirmNo: "No, Keep Playing"
    },

    // Internal State
    isAdActive: false,
    _adCountdownTimer: null,
    _currentPlacement: "",
    _gameEndedOverlay: null,
    _gameEndAcknowledged: false,
    _exitConfirmOverlay: null,
    _exitConfirmCallbacks: null,
    _exitConfirmKeyHandler: null,
    _exitConfirmTitleEl: null,
    _exitConfirmDescEl: null,
    _exitConfirmYesEl: null,
    _exitConfirmNoEl: null,

    /**
     * Called by Unity loader when WebGL engine is ready
     */
    initUnityInstance: function(instance) {
      this.unityInstance = instance;
      this.log("Unity WebGL Instance linked successfully.");
      
      // Auto-load game-config.json if available
      this.loadGameConfig();

      // Dispatch browser event so website scripts know game is ready
      this.dispatchEvent("unity:ready", { instance: instance });
    },

    /**
     * Dynamically loads game-config.json to sync ad settings, title, and metadata
     */
    loadGameConfig: function(callback) {
      const self = this;
      fetch("TemplateData/game-config.json")
        .then(function(res) {
          if (!res.ok) throw new Error("Status " + res.status);
          return res.json();
        })
        .then(function(data) {
          self.gameData = data;
          if (data.adsConfig) {
            self.config.testMode = data.adsConfig.testMode !== undefined ? data.adsConfig.testMode : self.config.testMode;
            self.config.googlePublisherId = data.adsConfig.publisherId || self.config.googlePublisherId;
            self.config.interstitialDuration = data.adsConfig.interstitialDuration || self.config.interstitialDuration;
            self.config.rewardedDuration = data.adsConfig.rewardedDuration || self.config.rewardedDuration;
          }
          self.log("Loaded game-config.json: '" + (data.productName || "Game") + "' (testMode: " + self.config.testMode + ")");
          if (window.checkDeviceOrientation) {
            window.checkDeviceOrientation();
          }
          if (callback) callback(data);
        })
        .catch(function(err) {
          self.log("game-config.json fetch note: " + err.message);
          if (window.checkDeviceOrientation) {
            window.checkDeviceOrientation();
          }
          if (callback) callback(null);
        });
    },

    /**
     * Unity calls this from C# to set the listening GameObject name
     */
    init: function(gameObjectName) {
      if (gameObjectName) {
        this.defaultTarget = gameObjectName;
      }
      this.log("Game target set to: " + this.defaultTarget);
    },

    // =========================================================================
    // 1. SEND MESSAGES FROM WEBSITE TO UNITY (Browser -> Game)
    // =========================================================================

    /**
     * Send any function call and data to a GameObject inside Unity
     * @param {string} gameObjectName - Name of GameObject in Unity scene (e.g. "[AdManager]", "Player")
     * @param {string} methodName - Public C# method name
     * @param {string|number} param - Parameter to pass
     */
    sendToGame: function(gameObjectName, methodName, param) {
      const target = gameObjectName || this.defaultTarget;
      const value = param !== undefined && param !== null ? String(param) : "";

      if (this.unityInstance) {
        this.log(`Sending to Unity [${target}.${methodName}]: "${value}"`);
        this.unityInstance.SendMessage(target, methodName, value);
      } else {
        console.warn(`[GameBridge] Cannot send message '${methodName}' - Unity instance is not loaded yet.`);
      }
    },

    /**
     * Trigger an Interstitial Ad (Level break, pause, etc.)
     * @param {string} placement - Name/id of placement (e.g. 'level_complete', 'main_menu')
     */
    showInterstitial: function(placement) {
      placement = placement || "interstitial_break";
      this._currentPlacement = placement;
      this.log("Requesting Interstitial Ad: " + placement);

      // Check for Google Ad Placement API (if not in test mode)
      if (!this.config.testMode && typeof window.adBreak === "function") {
        const self = this;
        try {
          window.adBreak({
            type: 'next',
            name: placement,
            beforeAd: function() { self.onAdOpened(placement); },
            afterAd: function() { self.onAdClosed(placement); },
            adBreakDone: function() { self.onInterstitialCompleted(placement); }
          });
          return;
        } catch (err) {
          console.warn("[GameBridge] Google adBreak error, using fallback modal: ", err);
        }
      }

      // Show built-in test preview modal
      this._showAdModal(false, placement);
    },

    /**
     * Trigger a Rewarded Ad (Watch video for game coins, lives, power-ups)
     * @param {string} placement - Name/id of reward (e.g. 'double_coins', 'revive_player')
     */
    showRewarded: function(placement) {
      placement = placement || "rewarded_ad";
      this._currentPlacement = placement;
      this.log("Requesting Rewarded Ad: " + placement);

      // Check for Google Ad Placement API (if not in test mode)
      if (!this.config.testMode && typeof window.adBreak === "function") {
        const self = this;
        try {
          window.adBreak({
            type: 'reward',
            name: placement,
            beforeAd: function() { self.onAdOpened(placement); },
            afterAd: function() { self.onAdClosed(placement); },
            beforeReward: function(showAdFn) { showAdFn(); },
            adDismissed: function() { self.onRewardedFailed(placement); },
            adViewed: function() { self.onRewardedSuccess(placement); },
            adBreakDone: function() { self.onAdClosed(placement); }
          });
          return;
        } catch (err) {
          console.warn("[GameBridge] Google adBreak error, using fallback modal: ", err);
        }
      }

      // Show built-in test preview modal
      this._showAdModal(true, placement);
    },

    /**
     * Pause game time from website
     */
    pauseGame: function() {
      this.sendToGame(this.defaultTarget, "OnAdOpened", "web_pause");
    },

    /**
     * Resume game time from website
     */
    resumeGame: function() {
      this.sendToGame(this.defaultTarget, "OnAdClosed", "web_resume");
    },

    /**
     * Check if an AdBlocker is enabled in user's browser
     */
    isAdBlockerActive: function() {
      return (typeof window.adsbygoogle === "undefined" && !this.config.testMode);
    },

    // =========================================================================
    // 1b. EXIT CONFIRMATION / END GAME / CLOSE TAB (Game -> Browser)
    // =========================================================================

    /**
     * Asks the player to confirm before the session ends.
     *
     * This is the entry point the in-game Exit button should use. It shows the
     * HTML confirmation popup; "Yes" falls through to endGame(), "No" just
     * dismisses the popup and leaves the game running untouched.
     *
     * Called from Unity through AdBridge.jslib -> JS_ConfirmExit.
     *
     * @param {object|string} extraData - Optional payload, forwarded to endGame on confirm
     * @param {object} options - Optional { title, message, confirmLabel, cancelLabel } overrides
     */
    confirmExit: function(extraData, options) {
      const self = this;
      const opts = options || {};

      // The game already ended - nothing left to confirm.
      if (this._gameEndedOverlay && this._gameEndedOverlay.style.display !== "none") {
        return;
      }

      // Already asking. Don't stack dialogs on a double tap.
      if (this._exitConfirmOverlay && this._exitConfirmOverlay.style.display !== "none") {
        this.log("Exit confirmation already open - ignoring repeat request.");
        return;
      }

      this.log("Exit confirmation requested.");
      this.dispatchEvent("unity:exitRequested", {
        action: "confirmExit",
        type: "EXIT_REQUESTED",
        data: extraData || ""
      });

      this._showExitConfirmPopup({
        title: opts.title || this.config.exitConfirmTitle,
        message: opts.message || this.config.exitConfirmMessage,
        confirmLabel: opts.confirmLabel || this.config.exitConfirmYes,
        cancelLabel: opts.cancelLabel || this.config.exitConfirmNo,
        onConfirm: function() {
          self.log("Exit confirmed by player.");
          self.endGame(extraData);
        },
        onCancel: function() {
          self.log("Exit cancelled by player - back to the game.");
          self.dispatchEvent("unity:exitCancelled", {
            action: "exitCancelled",
            type: "EXIT_CANCELLED"
          });
        }
      });
    },

    /**
     * Dismisses the confirmation popup and resumes play. Public so the host
     * page can close the dialog itself, and so the Escape key can reuse it.
     */
    cancelExit: function() {
      this.hideExitConfirmPopup();
      const cb = this._exitConfirmCallbacks;
      this._exitConfirmCallbacks = null;
      if (cb && typeof cb.onCancel === "function") {
        cb.onCancel();
      }
    },

    /**
     * Accepts the confirmation popup and ends the game. Public for the same
     * reason as cancelExit.
     */
    acceptExit: function() {
      this.hideExitConfirmPopup();
      const cb = this._exitConfirmCallbacks;
      this._exitConfirmCallbacks = null;
      if (cb && typeof cb.onConfirm === "function") {
        cb.onConfirm();
      }
    },

    /**
     * Ends the session and tries to get rid of the tab.
     *
     * Browsers only honour window.close() on a window that script itself
     * opened (window.open). A tab the player opened - by clicking a link in
     * the portal, or pasting a URL - cannot close itself, and Chrome just
     * logs "Scripts may close only the windows that were opened by them".
     * There is no way to ask up front, so we try to close and treat still
     * being alive a moment later as "it was refused" and show the popup.
     *
     * Order of preference:
     *   1. window.onGameEnded, if the host page defines it
     *   2. the host portal, when the game runs inside an iframe
     *   3. window.close()
     *   4. the "Game Ended" popup, telling the player to close the tab
     *
     * Called from Unity through AdBridge.jslib -> JS_EndGame. Prefer
     * confirmExit() from a button, so the player gets asked first.
     *
     * @param {object|string} extraData - Optional payload for the host
     */
    endGame: function(extraData) {
      const self = this;

      this.hideExitConfirmPopup();

      let data = extraData;
      if (typeof extraData === "string" && extraData.length > 0) {
        try { data = JSON.parse(extraData); } catch (e) { data = extraData; }
      }

      const payload = {
        action: "endGame",
        type: "GAME_ENDED",
        gameId: (this.gameData && this.gameData.gameId) || "",
        data: data || ""
      };

      this.log("End game requested: " + JSON.stringify(payload));

      // Let the game out of fullscreen first, otherwise the popup can end up
      // behind a fullscreen canvas.
      this._exitFullscreenIfNeeded();

      // 1. Broadcast so any host script can take over.
      this.dispatchEvent("unity:gameEnded", payload);
      this.dispatchEvent("game:end", payload);

      if (typeof window.onGameEnded === "function") {
        window.onGameEnded(payload);
        return;
      }

      // 2. Inside a portal iframe the tab belongs to the portal, not to us.
      // Hand it over and let the portal unmount the frame.
      if (window.parent && window.parent !== window) {
        // Arm this before posting: a same-origin parent can acknowledge
        // synchronously inside postMessage, and resetting afterwards would
        // throw that acknowledgement away and show the popup anyway.
        this._gameEndAcknowledged = false;

        try {
          window.parent.postMessage(payload, "*");
          this.log("Posted GAME_ENDED to parent portal.");
        } catch (e) {
          this.log("postMessage to parent failed: " + e.message);
        }

        setTimeout(function() {
          if (!self._gameEndAcknowledged) {
            self.log("No portal ack - showing the Game Ended popup.");
            self.showGameEndedPopup();
          }
        }, this.config.gameEndAckTimeout);
        return;
      }

      // 3. Standalone tab: try to close it, fall back to the popup.
      this.closeTab();
    },

    /**
     * Attempts to close the tab, and shows the "Game Ended" popup when the
     * browser refuses. If the close succeeds this page is torn down and the
     * timer below never runs, which is exactly the signal we rely on.
     */
    closeTab: function() {
      const self = this;

      try {
        window.close();
      } catch (e) {
        this.log("window.close() threw: " + e.message);
      }

      setTimeout(function() {
        self.log("Tab is still open - the browser refused window.close().");
        self.showGameEndedPopup();
      }, this.config.closeAttemptTimeout);
    },

    /**
     * Called by the portal to confirm it handled GAME_ENDED, so the fallback
     * popup stays out of the way.
     */
    acknowledgeGameEnd: function() {
      this._gameEndAcknowledged = true;
      this.log("Portal acknowledged game end.");
    },

    // -------------------------------------------------------------------------
    // Popups. Built in JS rather than read out of index.html so these work on
    // any template, including builds whose HTML predates the feature.
    // -------------------------------------------------------------------------

    /**
     * "Do you want to exit?" dialog with Yes / No.
     *
     * @param {object} cfg - { title, message, confirmLabel, cancelLabel, onConfirm, onCancel }
     */
    _showExitConfirmPopup: function(cfg) {
      const self = this;
      this._exitConfirmCallbacks = cfg;

      if (this._exitConfirmOverlay) {
        // Reuse the dialog we already built, refreshing its copy.
        if (this._exitConfirmTitleEl) this._exitConfirmTitleEl.textContent = cfg.title;
        if (this._exitConfirmDescEl) this._exitConfirmDescEl.textContent = cfg.message;
        if (this._exitConfirmYesEl) this._exitConfirmYesEl.textContent = cfg.confirmLabel;
        if (this._exitConfirmNoEl) this._exitConfirmNoEl.textContent = cfg.cancelLabel;
        this._exitConfirmOverlay.style.display = "flex";
        this._bindExitConfirmKeys();
        this._focusExitConfirmCancel();
        return;
      }

      const shell = this._createPopupShell("exit-confirm-overlay", "exit-confirm-title");
      const overlay = shell.overlay;
      const card = shell.card;

      const icon = document.createElement("div");
      icon.textContent = "🚪";
      icon.style.cssText = "font-size:42px;line-height:1;margin-bottom:14px";

      const title = document.createElement("h2");
      title.id = "exit-confirm-title";
      title.textContent = cfg.title;
      title.style.cssText = "margin:0 0 10px;font-size:23px;font-weight:800;letter-spacing:-0.3px";

      const desc = document.createElement("p");
      desc.textContent = cfg.message;
      desc.style.cssText = "margin:0 0 24px;font-size:14px;line-height:1.55;color:rgba(255,255,255,0.72)";

      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:12px;justify-content:center;flex-wrap:wrap";

      // "No" sits first so it reads left-to-right as cancel/confirm, and so
      // keyboard focus lands on the harmless option.
      const noBtn = document.createElement("button");
      noBtn.type = "button";
      noBtn.id = "exit-confirm-no";
      noBtn.textContent = cfg.cancelLabel;
      this._stylePopupButton(noBtn, "ghost");
      noBtn.onclick = function() { self.cancelExit(); };

      const yesBtn = document.createElement("button");
      yesBtn.type = "button";
      yesBtn.id = "exit-confirm-yes";
      yesBtn.textContent = cfg.confirmLabel;
      this._stylePopupButton(yesBtn, "primary");
      yesBtn.onclick = function() { self.acceptExit(); };

      row.appendChild(noBtn);
      row.appendChild(yesBtn);

      card.appendChild(icon);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(row);

      // Clicking the dimmed backdrop is a cancel, like any other dialog.
      overlay.onclick = function(e) {
        if (e && e.target === overlay) self.cancelExit();
      };

      document.body.appendChild(overlay);

      this._exitConfirmOverlay = overlay;
      this._exitConfirmTitleEl = title;
      this._exitConfirmDescEl = desc;
      this._exitConfirmYesEl = yesBtn;
      this._exitConfirmNoEl = noBtn;

      this._bindExitConfirmKeys();
      this._focusExitConfirmCancel();
      this.log("Exit confirmation popup shown.");
    },

    hideExitConfirmPopup: function() {
      this._unbindExitConfirmKeys();
      if (this._exitConfirmOverlay) {
        this._exitConfirmOverlay.style.display = "none";
      }
    },

    _focusExitConfirmCancel: function() {
      const btn = this._exitConfirmNoEl;
      if (!btn || typeof btn.focus !== "function") return;
      // Next tick: the element has to be in the document to take focus.
      setTimeout(function() {
        try { btn.focus(); } catch (e) { /* not fatal */ }
      }, 0);
    },

    _bindExitConfirmKeys: function() {
      const self = this;
      if (this._exitConfirmKeyHandler) return;

      this._exitConfirmKeyHandler = function(e) {
        if (e.key === "Escape" || e.keyCode === 27) {
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
          self.cancelExit();
        }
      };

      // Capture phase, because the Unity canvas swallows keydown otherwise.
      try {
        window.addEventListener("keydown", this._exitConfirmKeyHandler, true);
      } catch (e) {
        this._exitConfirmKeyHandler = null;
      }
    },

    _unbindExitConfirmKeys: function() {
      if (!this._exitConfirmKeyHandler) return;
      try {
        window.removeEventListener("keydown", this._exitConfirmKeyHandler, true);
      } catch (e) {
        // Nothing useful to do - drop the reference either way.
      }
      this._exitConfirmKeyHandler = null;
    },

    /**
     * Terminal "Game Ended" overlay, shown once the game is actually over and
     * the tab could not close itself. Deliberately has no dismiss button.
     *
     * @param {object} options - Optional { title, message } overrides
     */
    showGameEndedPopup: function(options) {
      const opts = options || {};

      if (this._gameEndedOverlay) {
        this._gameEndedOverlay.style.display = "flex";
        return;
      }

      const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
      const shortcut = isMac ? "⌘W" : "Ctrl + W";

      const shell = this._createPopupShell("game-ended-overlay", "game-ended-title");
      const overlay = shell.overlay;
      const card = shell.card;

      const icon = document.createElement("div");
      icon.textContent = "🏁";
      icon.style.cssText = "font-size:46px;line-height:1;margin-bottom:14px";

      const title = document.createElement("h2");
      title.id = "game-ended-title";
      title.textContent = opts.title || "Game Ended";
      title.style.cssText = "margin:0 0 10px;font-size:24px;font-weight:800;letter-spacing:-0.3px";

      const desc = document.createElement("p");
      desc.textContent = opts.message || "Thanks for playing! You can safely close this tab now.";
      desc.style.cssText = "margin:0 0 22px;font-size:14px;line-height:1.55;color:rgba(255,255,255,0.72)";

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "Close Tab";
      this._stylePopupButton(closeBtn, "primary");

      const hint = document.createElement("p");
      hint.textContent = "Your browser only lets a page close a tab it opened itself. Press " + shortcut + " to close this one.";
      hint.style.cssText = "margin:16px 0 0;font-size:12px;line-height:1.5;color:rgba(255,255,255,0.45);display:none";

      closeBtn.onclick = function() {
        // Worth retrying: it succeeds when the portal opened this tab with
        // window.open(), and is silently ignored otherwise.
        try { window.close(); } catch (e) { /* ignored */ }
        hint.style.display = "block";
      };

      card.appendChild(icon);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(closeBtn);
      card.appendChild(hint);
      document.body.appendChild(overlay);

      this._gameEndedOverlay = overlay;
      this.log("Game Ended popup shown.");
    },

    hideGameEndedPopup: function() {
      if (this._gameEndedOverlay) {
        this._gameEndedOverlay.style.display = "none";
      }
    },

    /**
     * The dark blurred overlay + card both popups sit in. Mirrors
     * #ad-modal-overlay in style.css so they feel like one product.
     */
    _createPopupShell: function(id, labelId) {
      const overlay = document.createElement("div");
      overlay.id = id;
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      if (labelId) overlay.setAttribute("aria-labelledby", labelId);
      overlay.style.cssText = [
        "position:fixed", "inset:0", "top:0", "left:0",
        "width:100%", "height:100%",
        "background:rgba(6,7,10,0.92)",
        "backdrop-filter:blur(14px)",
        "-webkit-backdrop-filter:blur(14px)",
        "z-index:10000",
        "display:flex",
        "justify-content:center",
        "align-items:center",
        "font-family:'Outfit',system-ui,-apple-system,sans-serif",
        "padding:16px",
        "box-sizing:border-box"
      ].join(";");

      const card = document.createElement("div");
      card.style.cssText = [
        "background:linear-gradient(160deg,#14161c,#0b0d12)",
        "border:1px solid rgba(255,255,255,0.12)",
        "border-radius:18px",
        "box-shadow:0 24px 70px rgba(0,0,0,0.6)",
        "max-width:420px", "width:100%",
        "padding:34px 28px",
        "text-align:center",
        "color:#fff",
        "box-sizing:border-box"
      ].join(";");

      overlay.appendChild(card);
      return { overlay: overlay, card: card };
    },

    _stylePopupButton: function(btn, kind) {
      const css = [
        "font-family:inherit", "font-size:14px", "font-weight:700",
        "padding:11px 24px", "border-radius:10px",
        "cursor:pointer", "transition:all 0.2s ease",
        "outline:none", "min-width:130px"
      ];

      if (kind === "ghost") {
        css.push(
          "background:rgba(255,255,255,0.08)",
          "color:#fff",
          "border:1px solid rgba(255,255,255,0.18)"
        );
      } else {
        css.push(
          "border:none",
          "background:linear-gradient(135deg,#00e676,#00b0ff)",
          "color:#06070a",
          "box-shadow:0 6px 20px rgba(0,230,118,0.35)"
        );
      }

      btn.style.cssText = css.join(";");
      return btn;
    },

    /**
     * Best-effort fullscreen exit, straight to the browser API.
     */
    _exitFullscreenIfNeeded: function() {
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      } catch (e) {
        // Not fatal - the popup is still readable over a fullscreen canvas.
      }
    },

    // =========================================================================
    // 2. CALLBACKS RECEIVED FROM ADS / DISPATCHED TO UNITY (Ad -> Game)
    // =========================================================================

    onAdOpened: function(placement) {
      this.isAdActive = true;
      this.log("Ad opened: " + placement);
      this.sendToGame(this.defaultTarget, "OnAdOpened", placement);
      this.dispatchEvent("unity:adOpened", { placement: placement });
    },

    onAdClosed: function(placement) {
      this.isAdActive = false;
      this.log("Ad closed: " + placement);
      this.sendToGame(this.defaultTarget, "OnAdClosed", placement);
      this.dispatchEvent("unity:adClosed", { placement: placement });
    },

    onInterstitialCompleted: function(placement) {
      this.log("Interstitial ad finished: " + placement);
      this.sendToGame(this.defaultTarget, "OnInterstitialCompleted", placement);
      this.dispatchEvent("unity:interstitialDone", { placement: placement });
    },

    onRewardedSuccess: function(placement) {
      this.log("Rewarded ad watched successfully! Granting reward for: " + placement);
      this.sendToGame(this.defaultTarget, "OnRewardedSuccess", placement);
      this.dispatchEvent("unity:rewardGranted", { placement: placement });
    },

    onRewardedFailed: function(placement) {
      this.log("Rewarded ad skipped or failed: " + placement);
      this.sendToGame(this.defaultTarget, "OnRewardedFailed", placement);
      this.dispatchEvent("unity:rewardFailed", { placement: placement });
    },

    // =========================================================================
    // 3. TESTING MODAL & DOM OVERLAY (Interactive Ad Simulation)
    // =========================================================================

    _showAdModal: function(isRewarded, placement) {
      const self = this;
      const overlay = document.getElementById("ad-modal-overlay");
      if (!overlay) {
        console.warn("[GameBridge] #ad-modal-overlay element not found in HTML.");
        if (isRewarded) self.onRewardedSuccess(placement);
        else self.onInterstitialCompleted(placement);
        return;
      }

      const typeBadge = document.getElementById("ad-type-badge");
      const placementLabel = document.getElementById("ad-placement-label");
      const title = document.getElementById("ad-title");
      const desc = document.getElementById("ad-description");
      const icon = document.getElementById("ad-icon");
      const countdownSec = document.getElementById("ad-countdown-sec");
      const skipBtn = document.getElementById("ad-skip-btn");
      const rewardBtn = document.getElementById("ad-reward-btn");

      self.onAdOpened(placement);
      overlay.style.display = "flex";

      if (placementLabel) placementLabel.textContent = "Placement: " + placement;

      let secondsLeft = isRewarded ? self.config.rewardedDuration : self.config.interstitialDuration;

      if (isRewarded) {
        if (typeBadge) typeBadge.textContent = "⭐ REWARDED SPONSOR AD (TEST)";
        if (icon) icon.textContent = "💎";
        if (title) title.textContent = "Claim Your Exclusive In-Game Reward!";
        if (desc) desc.textContent = "Watch this sponsored break to unlock bonus coins and double your score!";
        if (skipBtn) {
          skipBtn.style.display = "inline-block";
          skipBtn.disabled = true;
          skipBtn.textContent = "Skip in " + secondsLeft + "s";
        }
        if (rewardBtn) rewardBtn.style.display = "none";
      } else {
        if (typeBadge) typeBadge.textContent = "📢 INTERSTITIAL AD (TEST)";
        if (icon) icon.textContent = "🚀";
        if (title) title.textContent = "Featured Game Showcase";
        if (desc) desc.textContent = "Explore thousands of free online web games right in your browser!";
        if (skipBtn) {
          skipBtn.style.display = "inline-block";
          skipBtn.disabled = true;
          skipBtn.textContent = "Skip in " + secondsLeft + "s";
        }
        if (rewardBtn) rewardBtn.style.display = "none";
      }

      if (countdownSec) countdownSec.textContent = secondsLeft + "s";

      if (self._adCountdownTimer) clearInterval(self._adCountdownTimer);

      self._adCountdownTimer = setInterval(function() {
        secondsLeft--;
        if (countdownSec) countdownSec.textContent = secondsLeft + "s";

        if (secondsLeft > 0) {
          if (skipBtn) skipBtn.textContent = "Skip in " + secondsLeft + "s";
        } else {
          clearInterval(self._adCountdownTimer);
          if (countdownSec) countdownSec.textContent = "Ready!";

          if (isRewarded) {
            if (skipBtn) skipBtn.style.display = "none";
            if (rewardBtn) {
              rewardBtn.style.display = "inline-block";
              rewardBtn.textContent = "🎉 CLAIM REWARD";
            }
          } else {
            if (skipBtn) {
              skipBtn.disabled = false;
              skipBtn.textContent = "Close Ad ✕";
            }
          }
        }
      }, 1000);

      // Skip / Close Button
      if (skipBtn) {
        skipBtn.onclick = function() {
          if (skipBtn.disabled) return;
          self._closeAdModal();
          self.onInterstitialCompleted(placement);
        };
      }

      // Claim Reward Button
      if (rewardBtn) {
        rewardBtn.onclick = function() {
          self._closeAdModal();
          self.onRewardedSuccess(placement);
        };
      }
    },

    _closeAdModal: function() {
      const overlay = document.getElementById("ad-modal-overlay");
      if (overlay) overlay.style.display = "none";
      if (this._adCountdownTimer) clearInterval(this._adCountdownTimer);
      this.onAdClosed(this._currentPlacement);
    },

    // =========================================================================
    // 4. HELPER UTILITIES
    // =========================================================================

    dispatchEvent: function(eventName, detail) {
      try {
        const event = new CustomEvent(eventName, { detail: detail });
        window.dispatchEvent(event);
      } catch (e) {
        // Fallback for older browsers
      }
    },

    log: function(msg) {
      if (this.config.debugLogs) {
        console.log("%c[GameBridge]%c " + msg, "background: #7928ca; color: #fff; padding: 2px 6px; border-radius: 4px;", "color: inherit;");
      }
    }
  };

  // Expose both namespaces for convenience and backwards compatibility
  window.GameBridge = GameBridge;
  window.UnityAdBridge = GameBridge;

})(window);
