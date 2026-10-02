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
      debugLogs: true
    },

    // Internal State
    isAdActive: false,
    _adCountdownTimer: null,
    _currentPlacement: "",

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
