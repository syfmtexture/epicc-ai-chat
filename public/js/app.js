/* ═══════════════════════════════════════════════════════════════════════════
   EPICC AI — Main Application Logic
   ═══════════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────
  let chats = {};          // { id: { id, title, messages: [{role, content}], model, createdAt } }
  let activeChatId = null;
  let isGenerating = false;
  let abortController = null;
  let syncDebounceTimer = null;

  // Settings
  let settings = {
    geminiKey: '',
    groqKey: '',
    siliconflowKey: '',
    googleClientId: '581112509951-1vujj9af2bj1aceif3ctdtas4blrm80p.apps.googleusercontent.com',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 2048,
    selectedModel: 'google/gemini-3.5-flash',
    thinkingLevel: 'high'
  };

  // ─── DOM References ────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const sidebar = $('#sidebar');
  const sidebarOpenBtn = $('#sidebar-open-btn');
  const sidebarCloseBtn = $('#sidebar-close-btn');
  const newChatBtn = $('#new-chat-btn');
  const chatHistoryList = $('#chat-history-list');

  const modelSelect = $('#model-select');
  const thinkingSelect = $('#thinking-select');
  const chatViewport = $('#chat-viewport');
  const welcomeScreen = $('#welcome-screen');
  const messagesContainer = $('#messages-container');
  const messageInput = $('#message-input');
  const sendBtn = $('#send-btn');
  const stopBtn = $('#stop-btn');

  const settingsModal = $('#settings-modal');
  const settingsBtn = $('#settings-btn');
  const settingsCloseBtn = $('#settings-close-btn');
  const settingsSaveBtn = $('#settings-save-btn');
  const googleClientIdInput = $('#google-client-id-input');
  const geminiKeyInput = $('#gemini-key-input');
  const groqKeyInput = $('#groq-key-input');
  const siliconflowKeyInput = $('#siliconflow-key-input');
  const systemPromptInput = $('#system-prompt-input');
  const temperatureInput = $('#temperature-input');
  const maxTokensInput = $('#max-tokens-input');
  const clearAllDataBtn = $('#clear-all-data-btn');

  const renameModal = $('#rename-modal');
  const renameInput = $('#rename-input');
  const renameCloseBtn = $('#rename-close-btn');
  const renameCancelBtn = $('#rename-cancel-btn');
  const renameSaveBtn = $('#rename-save-btn');

  const googleSigninBtn = $('#google-signin-btn');
  const logoutBtn = $('#logout-btn');
  const userProfile = $('#user-profile');
  const userAvatar = $('#user-avatar');
  const userName = $('#user-name');
  const userEmail = $('#user-email');
  const syncStatus = $('#sync-status');
  const syncStatusText = $('#sync-status-text');

  let renamingChatId = null;

  // ─── Thinking Toggle & Dynamic Task-based Model Switcher ────────────────
  function getFriendlyModelName(modelValue) {
    if (!modelValue) return 'Epicc';
    const slashIdx = modelValue.indexOf('/');
    const modelName = slashIdx !== -1 ? modelValue.substring(slashIdx + 1) : modelValue;

    if (modelName === 'gemini-3.5-flash') return 'Gemini 3.5 Flash';
    if (modelName === 'gemini-3.1-flash-lite') return 'Gemini 3.1 Flash Lite';
    if (modelName === 'gemini-2.5-flash') return 'Gemini 2.5 Flash';
    if (modelName === 'gemini-2.5-flash-lite') return 'Gemini 2.5 Flash Lite';
    if (modelName === 'gemma-4-26b-a4b-it') return 'Gemma 4 26B';
    if (modelName === 'gemma-4-31b-it') return 'Gemma 4 31B';
    if (modelName === 'llama-3.3-70b-versatile') return 'Llama 3.3 70B';
    if (modelName === 'llama-3.1-8b-instant') return 'Llama 3.1 8B';
    if (modelName === 'groq/compound') return 'Groq Compound';
    if (modelName === 'deepseek-ai/DeepSeek-V3') return 'DeepSeek V3';
    if (modelName === 'deepseek-ai/DeepSeek-V4-Flash') return 'DeepSeek V4 Flash';
    if (modelName === 'deepseek-ai/DeepSeek-V4-Pro') return 'DeepSeek V4 Pro';
    if (modelName === 'zai-org/GLM-5.1') return 'GLM 5.1';
    if (modelName === 'zai-org/GLM-5.2') return 'GLM 5.2';
    if (modelName === 'zai-org/GLM-5V-Turbo') return 'GLM 5V Turbo';

    return modelName.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  function chooseModelForTask(prompt) {
    const text = prompt.toLowerCase();
    const hasGemini = !!settings.geminiKey || true;
    const hasGroq = !!settings.groqKey || true;
    const hasSiliconFlow = !!settings.siliconflowKey || true;
    const thinkingEnabled = settings.thinkingLevel === 'high';

    // 1. Coding / Tech task keywords
    const isCoding = /\b(code|function|python|js|javascript|html|css|sql|rust|golang|compiler|regex|api|bug|class|json|arrays|loops|async|git)\b/.test(text) ||
                     text.includes('{') || text.includes('}') || text.includes('=>') || text.includes('console.log');

    // 2. Math / Logical reasoning keywords
    const isLogical = /\b(calculate|equation|math|algebra|geometry|calculus|proof|probability|statistics|solve|logic|deduct|reasoning|analyse|matrix|vector)\b/.test(text);

    const isHeavy = isCoding || isLogical;

    // Use SiliconFlow only for heavy tasks if available
    if (hasSiliconFlow && isHeavy) {
      if (thinkingEnabled) {
        return { provider: 'siliconflow', model: 'siliconflow/deepseek-ai/DeepSeek-V4-Pro' };
      } else {
        return { provider: 'siliconflow', model: 'siliconflow/zai-org/GLM-5.2' };
      }
    }

    // Default to Gemini / Groq for normal tasks
    if (hasGemini && hasGroq) {
      if (thinkingEnabled) {
        return { provider: 'google', model: 'google/gemini-3.5-flash' };
      } else {
        if (isCoding) {
          return { provider: 'groq', model: 'groq/llama-3.3-70b-versatile' };
        } else {
          return { provider: 'google', model: 'google/gemini-3.1-flash-lite' };
        }
      }
    } else if (hasGemini) {
      if (thinkingEnabled) {
        return { provider: 'google', model: 'google/gemini-3.5-flash' };
      } else {
        return { provider: 'google', model: 'google/gemini-3.1-flash-lite' };
      }
    } else if (hasGroq) {
      if (thinkingEnabled || isCoding || isLogical) {
        return { provider: 'groq', model: 'groq/llama-3.3-70b-versatile' };
      } else {
        return { provider: 'groq', model: 'groq/llama-3.1-8b-instant' };
      }
    } else if (hasSiliconFlow) {
      // Fallback to SiliconFlow if nothing else is available (even for light tasks)
      if (thinkingEnabled) {
        return { provider: 'siliconflow', model: 'siliconflow/deepseek-ai/DeepSeek-V3' };
      } else {
        return { provider: 'siliconflow', model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash' };
      }
    } else {
      return { provider: 'google', model: 'google/gemini-3.5-flash' };
    }
  }

  function isPremiumModel(modelValue) {
    if (!modelValue) return false;
    const lower = modelValue.toLowerCase();
    return lower.includes('gemini') || lower.includes('deepseek') || lower.includes('glm');
  }

  function getPremiumMessageCount() {
    let count = 0;
    Object.values(chats).forEach(chat => {
      if (chat.messages) {
        chat.messages.forEach(msg => {
          if (msg.role === 'user' && msg.usedPremium) {
            count++;
          }
        });
      }
    });
    return count;
  }

  const welcomePhrases = [
    { text: "The mic is yours", type: "statement" },
    { text: "What are we building today", type: "question" },
    { text: "Let's make something epic", type: "exclamation" },
    { text: "How can I help you excel today", type: "question" },
    { text: "Ready to co-pilot your next breakthrough", type: "statement" },
    { text: "Let's solve some complex challenges", type: "exclamation" },
    { text: "What's on your mind today", type: "question" },
    { text: "How can I accelerate your work today", type: "question" },
    { text: "Your creative canvas is ready", type: "statement" },
    { text: "Let's turn ideas into code", type: "exclamation" },
    { text: "Ready to design, code, or write", type: "statement" },
    { text: "What are we exploring today", type: "question" },
    { text: "Unleash your productivity today", type: "exclamation" },
    { text: "Let's brainstorm together", type: "exclamation" },
    { text: "Let's build something incredible today", type: "exclamation" },
    { text: "Ready to write some great code", type: "statement" },
    { text: "Collaborate, create, compute", type: "exclamation" },
    { text: "Let's debug or design", type: "exclamation" },
    { text: "The canvas is empty, let's fill it", type: "statement" },
    { text: "Tell me your biggest idea", type: "exclamation" },
    { text: "Ready to write, code, or solve", type: "statement" },
    { text: "Let's optimize your workflow today", type: "exclamation" },
    { text: "A fresh start. What's the goal", type: "question" },
    { text: "How can I help you innovate today", type: "question" },
    { text: "Ready for your commands", type: "statement" },
    { text: "Let's create something smart", type: "exclamation" },
    { text: "Let's craft some elegant solutions", type: "exclamation" },
    { text: "From concept to creation", type: "exclamation" },
    { text: "What shall we conquer today", type: "question" },
    { text: "Ready to help you think deeper", type: "statement" },
    { text: "Let's outline your next project", type: "exclamation" },
    { text: "Spark your next idea here", type: "exclamation" },
    { text: "How can I simplify your task today", type: "question" },
    { text: "Your developer co-pilot is ready", type: "statement" },
    { text: "Let's design something premium", type: "exclamation" },
    { text: "What's the master plan today", type: "question" },
    { text: "Ready when you are", type: "exclamation" },
    { text: "Let's turn complexity into clarity", type: "exclamation" },
    { text: "Empower your coding session today", type: "exclamation" },
    { text: "Let's make magic happen", type: "exclamation" }
  ];

  let currentWelcomePhrase = null;

  function selectRandomWelcomePhrase() {
    const randomIndex = Math.floor(Math.random() * welcomePhrases.length);
    currentWelcomePhrase = welcomePhrases[randomIndex];
  }

  function getLoggedInName() {
    if (userProfile && userProfile.style.display !== 'none') {
      const name = userName.textContent;
      return name === 'User' ? '' : name;
    }
    return '';
  }

  function updateWelcomeTitle(name) {
    const welcomeTitle = $('#welcome-title');
    if (!welcomeTitle) return;

    if (!currentWelcomePhrase) {
      selectRandomWelcomePhrase();
    }

    const firstName = name ? name.split(' ')[0] : '';
    let formattedText = currentWelcomePhrase.text;

    if (firstName) {
      const escapedName = `<span class="gradient-text">${escapeHtml(firstName)}</span>`;
      if (currentWelcomePhrase.type === 'question') {
        formattedText = `${currentWelcomePhrase.text}, ${escapedName}?`;
      } else if (currentWelcomePhrase.type === 'exclamation') {
        formattedText = `${currentWelcomePhrase.text}, ${escapedName}!`;
      } else {
        formattedText = `${currentWelcomePhrase.text}, ${escapedName}`;
      }
    } else {
      if (currentWelcomePhrase.type === 'question') {
        formattedText = `${currentWelcomePhrase.text}?`;
      } else if (currentWelcomePhrase.type === 'exclamation') {
        formattedText = `${currentWelcomePhrase.text}!`;
      } else {
        formattedText = `${currentWelcomePhrase.text}`;
      }
    }

    welcomeTitle.innerHTML = formattedText;
  }

  function initThinkingToggle() {
    const toggleBtn = $('#thinking-toggle-btn');
    if (!toggleBtn) return;

    const nativeThinkingSelect = $('#thinking-select');

    toggleBtn.addEventListener('click', () => {
      const isActive = toggleBtn.classList.toggle('active');
      const val = isActive ? 'high' : 'low';
      
      settings.thinkingLevel = val;
      if (nativeThinkingSelect) {
        nativeThinkingSelect.value = val;
        nativeThinkingSelect.dispatchEvent(new Event('change'));
      }
      persistAll();
    });

    function syncToggle() {
      const isHigh = settings.thinkingLevel === 'high';
      if (isHigh) {
        toggleBtn.classList.add('active');
      } else {
        toggleBtn.classList.remove('active');
      }
      if (nativeThinkingSelect) {
        nativeThinkingSelect.value = settings.thinkingLevel;
      }
    }

    syncToggle();
    if (nativeThinkingSelect) {
      nativeThinkingSelect.addEventListener('change', () => {
        settings.thinkingLevel = nativeThinkingSelect.value;
        syncToggle();
      });
    }
  }

  // ─── Initialization ────────────────────────────────────────────────────
  function init() {
    initThinkingToggle();
    loadFromLocalStorage();
    bindEvents();
    renderChatHistory();
    applySettings();
    initGoogleDrive();

    // Clean up any empty chats (no messages) left over from previous sessions
    for (const id of Object.keys(chats)) {
      if (!chats[id].messages || chats[id].messages.length === 0) {
        delete chats[id];
      }
    }
    saveToLocalStorage();

    // If we have chats, open the most recent one
    const chatIds = Object.keys(chats);
    if (chatIds.length > 0) {
       const sorted = chatIds.sort((a, b) => (chats[b].createdAt || 0) - (chats[a].createdAt || 0));
       openChat(sorted[0]);
    } else {
       showWelcome();
    }
  }

  // ─── Local Storage ─────────────────────────────────────────────────────
  function loadFromLocalStorage() {
    try {
      const savedChats = localStorage.getItem('epicc_chats');
      if (savedChats) chats = JSON.parse(savedChats);

      const savedSettings = localStorage.getItem('epicc_settings');
      if (savedSettings) {
        settings = { ...settings, ...JSON.parse(savedSettings) };
      }
      
      // Ensure default values for new settings keys or migrate problematic values
      if (!settings.thinkingLevel) {
        settings.thinkingLevel = 'high';
      }
      if (!settings.geminiKey) {
        settings.geminiKey = '';
      }
      if (!settings.groqKey) {
        settings.groqKey = '';
      }
      if (!settings.siliconflowKey) {
        settings.siliconflowKey = '';
      }
      if (!settings.googleClientId) {
        settings.googleClientId = '581112509951-1vujj9af2bj1aceif3ctdtas4blrm80p.apps.googleusercontent.com';
      }
      if (settings.maxTokens === 8192) {
        settings.maxTokens = 2048; // auto-migrate from problematic default
      }
    } catch (e) {
      console.error('Failed to load from localStorage:', e);
    }
  }

  function saveToLocalStorage() {
    try {
      localStorage.setItem('epicc_chats', JSON.stringify(chats));
      localStorage.setItem('epicc_settings', JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }

  function persistAll() {
    saveToLocalStorage();
    debounceDriveSync();
  }

  // ─── Google Drive Sync ─────────────────────────────────────────────────
  function initGoogleDrive() {
    if (!settings.googleClientId) return;

    DriveSync.init(settings.googleClientId, {
      onSignIn: handleGoogleSignIn,
      onSignOut: handleGoogleSignOut,
      onSyncStatusChange: handleSyncStatusChange
    });
  }

  async function handleGoogleSignIn(user) {
    // Show user profile in sidebar
    googleSigninBtn.style.display = 'none';
    userProfile.style.display = 'flex';
    syncStatus.style.display = 'flex';

    userAvatar.src = user.picture || '';
    userName.textContent = user.name || 'User';
    userEmail.textContent = user.email || '';

    updateWelcomeTitle(user.name);

    if (!DriveSync.hasDrivePermission()) {
      handleSyncStatusChange('error', 'Local Only (No Drive Scope)');
      return;
    }

    // Load data from Drive
    const driveChats = await DriveSync.loadData('epicc_chats.json');
    const driveSettings = await DriveSync.loadData('epicc_settings.json');

    if (driveChats) {
      // Merge: Drive data wins for existing, local-only chats are kept
      chats = { ...chats, ...driveChats };
      saveToLocalStorage();
      renderChatHistory();

      // Re-open active chat if it still exists
      if (activeChatId && chats[activeChatId]) {
        openChat(activeChatId);
      }
    }

    if (driveSettings) {
      // Merge keys from drive (but don't overwrite current google client ID)
      const currentClientId = settings.googleClientId;
      settings = { ...settings, ...driveSettings, googleClientId: currentClientId };
      saveToLocalStorage();
      applySettings();
    }
  }

  function handleGoogleSignOut() {
    googleSigninBtn.style.display = '';
    userProfile.style.display = 'none';
    syncStatus.style.display = 'none';
    updateWelcomeTitle('');
  }

  function handleSyncStatusChange(state, text) {
    syncStatus.style.display = 'flex';
    syncStatus.className = `sync-status ${state}`;
    syncStatusText.textContent = text;

    if (state === 'syncing') {
      syncStatus.querySelector('i').className = 'fa-solid fa-rotate';
    } else if (state === 'synced') {
      syncStatus.querySelector('i').className = 'fa-solid fa-cloud';
    } else {
      syncStatus.querySelector('i').className = 'fa-solid fa-cloud-exclamation';
    }
  }

  function debounceDriveSync() {
    if (!DriveSync.hasDrivePermission()) return;
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(async () => {
      await DriveSync.saveData('epicc_chats.json', chats);
      // Save settings too but strip the google client ID for security
      const settingsToSave = { ...settings };
      delete settingsToSave.googleClientId;
      await DriveSync.saveData('epicc_settings.json', settingsToSave);
    }, 1500);
  }

  // ─── Event Bindings ────────────────────────────────────────────────────
  function bindEvents() {
    // Sidebar toggle
    sidebarOpenBtn.addEventListener('click', () => sidebar.classList.add('open'));
    sidebarCloseBtn.addEventListener('click', () => sidebar.classList.remove('open'));

    // New chat
    newChatBtn.addEventListener('click', createNewChat);

    const topbarNewChatBtn = $('#topbar-new-chat-btn');
    if (topbarNewChatBtn) {
      topbarNewChatBtn.addEventListener('click', createNewChat);
    }

    // Model selector
    modelSelect.addEventListener('change', () => {
      settings.selectedModel = modelSelect.value;
      persistAll();
    });

    // Thinking selector
    thinkingSelect.addEventListener('change', () => {
      settings.thinkingLevel = thinkingSelect.value;
      persistAll();
    });

    // Message input
    messageInput.addEventListener('input', () => {
      autoResizeTextarea();
      sendBtn.disabled = messageInput.value.trim() === '';
    });

    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled && !isGenerating) sendMessage();
      }
    });

    // Send / Stop
    sendBtn.addEventListener('click', sendMessage);
    stopBtn.addEventListener('click', stopGenerating);

    // Welcome chips
    $$('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const prompt = chip.dataset.prompt;
        messageInput.value = prompt;
        sendBtn.disabled = false;
        sendMessage();
      });
    });

    // Settings modal
    settingsBtn.addEventListener('click', openSettings);
    settingsCloseBtn.addEventListener('click', closeSettings);
    settingsSaveBtn.addEventListener('click', saveSettings);
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettings();
    });

    // Toggle password visibility
    $$('.toggle-key-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = $(`#${btn.dataset.target}`);
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.querySelector('i').className = isPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
      });
    });

    // Clear data
    clearAllDataBtn.addEventListener('click', () => {
      if (confirm('This will clear all local chat history and settings. Are you sure?')) {
        chats = {};
        activeChatId = null;
        settings = {
          geminiKey: '',
          groqKey: '',
          siliconflowKey: 'sk-xpgnarxttjcfokxnzubazlhpaxnsgtnmqijouwjvgcfdtwcs',
          googleClientId: settings.googleClientId, // keep client ID
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 8192,
          selectedModel: 'google/gemini-3.5-flash'
        };
        saveToLocalStorage();
        renderChatHistory();
        showWelcome();
        closeSettings();
      }
    });

    // Rename modal
    renameCloseBtn.addEventListener('click', closeRename);
    renameCancelBtn.addEventListener('click', closeRename);
    renameSaveBtn.addEventListener('click', saveRename);
    renameModal.addEventListener('click', (e) => {
      if (e.target === renameModal) closeRename();
    });
    renameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveRename();
    });

    // Google Auth
    googleSigninBtn.addEventListener('click', () => {
      if (!settings.googleClientId) {
        openSettings();
        alert('Please enter your Google OAuth Client ID first.');
        return;
      }
      DriveSync.signIn();
    });

    logoutBtn.addEventListener('click', () => {
      DriveSync.signOut();
    });

    // Close chat history dropdown menus when clicking elsewhere
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.chat-item-menu-container')) {
        document.querySelectorAll('.chat-menu-dropdown.show').forEach(d => {
          d.classList.remove('show');
        });
      }
    });
  }

  // ─── Chat Management ───────────────────────────────────────────────────
  function createNewChat() {
    // Don't create a chat object yet — just reset the UI.
    // The actual chat entry is created in sendMessage() on first message.
    activeChatId = null;
    selectRandomWelcomePhrase();
    renderMessages();
    renderChatHistory();
    messageInput.value = '';
    sendBtn.disabled = true;
    messageInput.focus();
    sidebar.classList.remove('open');
  }

  function openChat(id) {
    if (!chats[id]) return;
    activeChatId = id;

    // Set model to the chat's model if it exists in the selector
    if (chats[id].model) {
      const option = modelSelect.querySelector(`option[value="${chats[id].model}"]`);
      if (option) {
        modelSelect.value = chats[id].model;
        settings.selectedModel = chats[id].model;
      }
    }

    renderChatHistory();
    renderMessages();
    sidebar.classList.remove('open');
  }

  function deleteChat(id) {
    if (!confirm('Delete this chat?')) return;
    delete chats[id];
    if (activeChatId === id) {
      activeChatId = null;
      const remaining = Object.keys(chats);
      if (remaining.length > 0) {
        openChat(remaining[remaining.length - 1]);
      } else {
        showWelcome();
      }
    }
    persistAll();
    renderChatHistory();
  }

  function openRename(id) {
    renamingChatId = id;
    renameInput.value = chats[id]?.title || '';
    renameModal.style.display = 'flex';
    renameInput.focus();
    renameInput.select();
  }

  function closeRename() {
    renameModal.style.display = 'none';
    renamingChatId = null;
  }

  function saveRename() {
    if (renamingChatId && chats[renamingChatId]) {
      chats[renamingChatId].title = renameInput.value.trim() || 'Untitled';
      persistAll();
      renderChatHistory();
    }
    closeRename();
  }

  // ─── Rendering ─────────────────────────────────────────────────────────
  function showWelcome() {
    welcomeScreen.style.display = 'flex';
    messagesContainer.style.display = 'none';
    const mainContent = $('.main-content');
    if (mainContent) mainContent.classList.add('welcome-active');
  }

  function showChat() {
    welcomeScreen.style.display = 'none';
    messagesContainer.style.display = 'flex';
    const mainContent = $('.main-content');
    if (mainContent) mainContent.classList.remove('welcome-active');
  }

  function renderChatHistory() {
    chatHistoryList.innerHTML = '';

    const sorted = Object.values(chats).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    sorted.forEach(chat => {
      const item = document.createElement('div');
      item.className = `chat-history-item${chat.id === activeChatId ? ' active' : ''}`;
      item.innerHTML = `
        <i class="fa-regular fa-message" style="font-size:0.82rem; flex-shrink:0;"></i>
        <span class="chat-title">${escapeHtml(chat.title)}</span>
        <div class="chat-item-menu-container">
          <button class="chat-menu-btn" title="Options">
            <i class="fa-solid fa-ellipsis-vertical"></i>
          </button>
          <div class="chat-menu-dropdown">
            <button class="dropdown-item rename-btn">
              <i class="fa-solid fa-pen" style="font-size:0.75rem;"></i> Rename
            </button>
            <button class="dropdown-item delete-btn">
              <i class="fa-solid fa-trash" style="font-size:0.75rem;"></i> Delete
            </button>
          </div>
        </div>
      `;

      // Click to open
      item.addEventListener('click', (e) => {
        if (e.target.closest('.chat-menu-btn') || e.target.closest('.chat-menu-dropdown')) return;
        openChat(chat.id);
      });

      const menuBtn = item.querySelector('.chat-menu-btn');
      const dropdown = item.querySelector('.chat-menu-dropdown');

      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close all other dropdowns first
        document.querySelectorAll('.chat-menu-dropdown').forEach(d => {
          if (d !== dropdown) d.classList.remove('show');
        });
        dropdown.classList.toggle('show');
      });

      dropdown.querySelector('.rename-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.remove('show');
        openRename(chat.id);
      });

      dropdown.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.remove('show');
        deleteChat(chat.id);
      });

      chatHistoryList.appendChild(item);
    });
  }

  function parseMessageThoughts(msg) {
    let thoughts = msg.thoughts || '';
    let content = msg.content || '';

    // If the content has <think> tags, extract them
    if (content.includes('<think>')) {
      const parts = content.split('<think>');
      const beforeThink = parts[0];
      const rest = parts.slice(1).join('<think>');

      if (rest.includes('</think>')) {
        const subParts = rest.split('</think>');
        const thinkVal = subParts[0];
        const afterThink = subParts.slice(1).join('</think>');

        thoughts = (thoughts ? thoughts + '\n' : '') + thinkVal;
        content = beforeThink + afterThink;
      } else {
        thoughts = (thoughts ? thoughts + '\n' : '') + rest;
        content = beforeThink;
      }
    }

    // Do the same for legacy <thought> tags
    if (content.includes('<thought>')) {
      const parts = content.split('<thought>');
      const beforeThought = parts[0];
      const rest = parts.slice(1).join('<thought>');

      if (rest.includes('</thought>')) {
        const subParts = rest.split('</thought>');
        const thinkVal = subParts[0];
        const afterThought = subParts.slice(1).join('</thought>');

        thoughts = (thoughts ? thoughts + '\n' : '') + thinkVal;
        content = beforeThought + afterThought;
      } else {
        thoughts = (thoughts ? thoughts + '\n' : '') + rest;
        content = beforeThought;
      }
    }

    return {
      thoughts: thoughts.trim(),
      content: content.trim()
    };
  }

  function renderMessages() {
    messagesContainer.innerHTML = '';
    if (!activeChatId || !chats[activeChatId]) {
      updateWelcomeTitle(getLoggedInName());
      showWelcome();
      return;
    }

    const chat = chats[activeChatId];
    if (chat.messages.length === 0) {
      updateWelcomeTitle(getLoggedInName());
      showWelcome();
      return;
    }

    showChat();
    chat.messages.forEach((msg, idx) => {
      appendMessageToDOM(msg.role, msg.content, msg.thoughts, false, msg.isError, idx);
    });

    scrollToBottom();
  }

  function addMessageActions(messageDiv, content, messageIndex) {
    const existing = messageDiv.querySelector('.message-actions');
    if (existing) existing.remove();

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';
    actionsDiv.innerHTML = `
      <button class="msg-action-btn copy-btn" data-tooltip="Copy response"><i class="fa-regular fa-copy"></i></button>
      <button class="msg-action-btn share-btn" data-tooltip="Share response"><i class="fa-regular fa-share-from-square"></i></button>
      <button class="msg-action-btn retry-btn" data-tooltip="Retry from here"><i class="fa-solid fa-rotate-right"></i></button>
    `;

    actionsDiv.querySelector('.copy-btn').addEventListener('click', (e) => {
      navigator.clipboard.writeText(content).then(() => {
        const icon = e.currentTarget.querySelector('i');
        icon.className = 'fa-solid fa-check';
        setTimeout(() => { icon.className = 'fa-regular fa-copy'; }, 2000);
      });
    });

    actionsDiv.querySelector('.share-btn').addEventListener('click', (e) => {
      if (navigator.share) {
        navigator.share({
          title: 'Epicc AI Response',
          text: content
        }).catch(console.error);
      } else {
        navigator.clipboard.writeText(content).then(() => {
          const icon = e.currentTarget.querySelector('i');
          icon.className = 'fa-solid fa-check';
          setTimeout(() => { icon.className = 'fa-regular fa-share-from-square'; }, 2000);
        });
      }
    });

    actionsDiv.querySelector('.retry-btn').addEventListener('click', () => {
      retryFromMessage(messageIndex);
    });

    messageDiv.appendChild(actionsDiv);
  }

  async function retryFromMessage(messageIndex) {
    if (isGenerating) return;
    if (!activeChatId || !chats[activeChatId]) return;

    const chat = chats[activeChatId];
    if (messageIndex <= 0) return;

    // Slice the messages list up to the user message
    chat.messages = chat.messages.slice(0, messageIndex);

    // Re-resolve dynamic model for the task based on user query
    const lastUserMsg = chat.messages[chat.messages.length - 1];
    if (lastUserMsg && lastUserMsg.role === 'user') {
      const resolved = chooseModelForTask(lastUserMsg.content);
      chat.model = resolved.model;
    }

    persistAll();
    renderMessages();

    // Smooth scroll the user prompt to the top of the viewport
    const messageElements = messagesContainer.querySelectorAll('.message');
    if (messageElements.length > 0) {
      const lastUserMsg = messageElements[messageElements.length - 1];
      setTimeout(() => {
        lastUserMsg.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }

    await generateResponse(chat);
  }

  function makeMessageCollapsibleIfLong(messageDiv, role, content) {
    if (role !== 'user') return;
    const lineCount = content.split('\n').length;
    if (content.length <= 500 && lineCount <= 8) return;

    const contentEl = messageDiv.querySelector('.message-content');
    if (!contentEl) return;

    contentEl.classList.add('collapsible-content', 'collapsed');

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'message-toggle-btn';
    toggleBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i> Show More';

    toggleBtn.addEventListener('click', () => {
      const isCollapsed = contentEl.classList.toggle('collapsed');
      toggleBtn.innerHTML = isCollapsed 
        ? '<i class="fa-solid fa-chevron-down"></i> Show More' 
        : '<i class="fa-solid fa-chevron-up"></i> Show Less';
    });

    if (role === 'user') {
      const bubble = messageDiv.querySelector('.message-bubble');
      if (bubble) bubble.appendChild(toggleBtn);
    } else {
      messageDiv.appendChild(toggleBtn);
    }
  }

  function appendMessageToDOM(role, content, thoughts = '', isThinking = false, isError = false, messageIndex = null) {
    const div = document.createElement('div');
    div.className = `message ${role}${isError ? ' error' : ''}`;

    if (role === 'user') {
      div.innerHTML = `
        <div class="message-label">You</div>
        <div class="message-bubble">
          <div class="message-content">${escapeHtml(content)}</div>
        </div>
      `;
    } else {
      const parsed = parseMessageThoughts({ content, thoughts });
      let html = '';
      
      if (parsed.thoughts) {
        html += `
          <details class="thought-container" ${isThinking ? 'open' : ''}>
            <summary class="thought-header">
              <div class="thought-title-wrapper">
                <i class="fa-solid fa-brain" style="color:var(--accent-primary);"></i>
                <span>Thought Process</span>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="thought-indicator ${isThinking ? 'thinking' : ''}"></span>
                <i class="fa-solid fa-chevron-down thought-toggle-icon"></i>
              </div>
            </summary>
            <div class="thought-content">${MarkdownRenderer.render(parsed.thoughts)}</div>
          </details>
        `;
      }
      
      html += `<div class="message-content">${MarkdownRenderer.render(parsed.content)}</div>`;
      div.innerHTML = html;
    }

    messagesContainer.appendChild(div);
    makeMessageCollapsibleIfLong(div, role, content);
    if (role === 'assistant' && messageIndex !== null) {
      addMessageActions(div, content, messageIndex);
    }
    return div;
  }

  function createStreamingMessage(modelValue) {
    const div = document.createElement('div');
    div.className = 'message assistant';
    if (modelValue) {
      div.dataset.model = modelValue;
    }
    div.innerHTML = `
      <div class="message-content">
        <div class="typing-indicator">
          <div class="dot"></div>
          <div class="dot"></div>
          <div class="dot"></div>
        </div>
      </div>
    `;
    messagesContainer.appendChild(div);
    scrollToBottom();
    return div;
  }

  function updateStreamingMessage(div, fullContent, thoughts = '', isThinking = false, isError = false) {
    if (isError) {
      div.classList.add('error');
    } else {
      div.classList.remove('error');
    }

    const parsed = parseMessageThoughts({ content: fullContent, thoughts });
    let html = '';
    
    if (parsed.thoughts) {
      html += `
        <details class="thought-container" open>
          <summary class="thought-header">
            <div class="thought-title-wrapper">
              <i class="fa-solid fa-brain" style="color:var(--accent-primary);"></i>
              <span>Thought Process</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="thought-indicator ${isThinking ? 'thinking' : ''}"></span>
              <i class="fa-solid fa-chevron-down thought-toggle-icon"></i>
            </div>
          </summary>
          <div class="thought-content">${MarkdownRenderer.render(parsed.thoughts)}</div>
        </details>
      `;
    }
    
    if (parsed.content) {
      html += `<div class="message-content">${MarkdownRenderer.render(parsed.content)}</div>`;
    } else if (isThinking) {
      html += `
        <div class="message-content">
          <div class="typing-indicator">
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
          </div>
        </div>
      `;
    } else {
      html += `<div class="message-content"></div>`;
    }
    
    div.innerHTML = html;
    scrollToBottom();
  }

  function scrollToBottom() {
    chatViewport.scrollTop = chatViewport.scrollHeight;
  }

  // ─── Sending Messages ──────────────────────────────────────────────────
  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || isGenerating) return;

    // Create a new chat on the fly if none is active
    if (!activeChatId) {
      const id = 'chat_' + Date.now();
      chats[id] = {
        id,
        title: 'New Chat',
        messages: [],
        model: settings.selectedModel,
        createdAt: Date.now()
      };
      activeChatId = id;
      renderChatHistory();
    }

    const chat = chats[activeChatId];

    // Add user message
    chat.messages.push({ role: 'user', content: text });

    // Auto-title from first message
    if (chat.messages.length === 1) {
      chat.title = text.length > 50 ? text.substring(0, 50) + '...' : text;
      renderChatHistory();
    }

    // Determine and switch model depending on the task
    const resolved = chooseModelForTask(text);
    chat.model = resolved.model;

    // Clear input
    messageInput.value = '';
    sendBtn.disabled = true;
    autoResizeTextarea();

    // Show in UI
    showChat();
    const userMsgDiv = appendMessageToDOM('user', text);

    // Smooth scroll the new query to the top of the viewport
    setTimeout(() => {
      userMsgDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);

    // Persist user message
    persistAll();

    // Start generation
    await generateResponse(chat);
  }

  function chooseModelForProvider(provider, prompt) {
    const text = prompt.toLowerCase();
    const thinkingEnabled = settings.thinkingLevel === 'high';
    const isCoding = /\b(code|function|python|js|javascript|html|css|sql|rust|golang|compiler|regex|api|bug|class|json|arrays|loops|async|git)\b/.test(text) ||
                     text.includes('{') || text.includes('}') || text.includes('=>') || text.includes('console.log');
    const isLogical = /\b(calculate|equation|math|algebra|geometry|calculus|proof|probability|statistics|solve|logic|deduct|reasoning|analyse|matrix|vector)\b/.test(text);

    if (provider === 'siliconflow') {
      if (thinkingEnabled) {
        if (isCoding || isLogical) {
          return { provider: 'siliconflow', model: 'siliconflow/deepseek-ai/DeepSeek-V4-Pro' };
        } else {
          return { provider: 'siliconflow', model: 'siliconflow/deepseek-ai/DeepSeek-V3' };
        }
      } else {
        if (isCoding) {
          return { provider: 'siliconflow', model: 'siliconflow/zai-org/GLM-5.2' };
        } else {
          return { provider: 'siliconflow', model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash' };
        }
      }
    } else if (provider === 'google') {
      if (thinkingEnabled) {
        return { provider: 'google', model: 'google/gemini-3.5-flash' };
      } else {
        return { provider: 'google', model: 'google/gemini-3.1-flash-lite' };
      }
    } else {
      if (thinkingEnabled || isCoding || isLogical) {
        return { provider: 'groq', model: 'groq/llama-3.3-70b-versatile' };
      } else {
        return { provider: 'groq', model: 'groq/llama-3.1-8b-instant' };
      }
    }
  }

  function getFallbackList(primaryProvider, prompt) {
    const list = [];
    
    // Add primary choice first
    const primaryChoice = chooseModelForProvider(primaryProvider, prompt);
    list.push(primaryChoice);

    // Determine the backup providers in order
    const allProviders = ['siliconflow', 'google', 'groq'];
    allProviders.forEach(p => {
      if (p !== primaryChoice.provider) {
        list.push(chooseModelForProvider(p, prompt));
      }
    });

    return list;
  }

  async function generateResponse(chat) {
    isGenerating = true;
    sendBtn.style.display = 'none';
    stopBtn.style.display = 'flex';

    // Find the user's latest query
    let userQuery = '';
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'user') {
        userQuery = chat.messages[i].content;
        break;
      }
    }

    const primaryChoice = chooseModelForTask(userQuery);
    const fallbacks = getFallbackList(primaryChoice.provider, userQuery);

    let streamDiv = null;
    let success = false;
    let lastErrorMsg = '';

    for (const attempt of fallbacks) {
      const modelValue = attempt.model;
      const provider = attempt.provider;
      const model = modelValue.substring(modelValue.indexOf('/') + 1);

      // Check premium limits
      if (isPremiumModel(modelValue)) {
        const currentPremiumCount = getPremiumMessageCount();
        if (currentPremiumCount >= 20) {
          console.warn(`[Failover] Premium model ${modelValue} hit limit, trying next fallback...`);
          lastErrorMsg = 'You have reached the limit of 20 messages for premium models (DeepSeek, Gemini, GLM).';
          continue; // Try next fallback model!
        }
      }

      if (streamDiv) {
        streamDiv.remove();
      }
      streamDiv = createStreamingMessage(modelValue);

      let fullContent = '';
      let thoughtContent = '';
      let isThinking = false;
      let hasError = false;

      // Determine API key
      const apiKey = provider === 'google' 
        ? settings.geminiKey 
        : (provider === 'siliconflow' ? settings.siliconflowKey : settings.groqKey);

      abortController = new AbortController();

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            provider,
            model,
            messages: chat.messages.filter(m => m.role === 'user' || m.role === 'assistant'),
            apiKey,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
            systemPrompt: settings.systemPrompt || undefined,
            thinkingLevel: settings.thinkingLevel
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(errText || `Server error ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                  throw new Error(typeof parsed.error === 'object' ? parsed.error.message : parsed.error);
                } else if (parsed.thought) {
                  isThinking = true;
                  thoughtContent += parsed.thought;
                  updateStreamingMessage(streamDiv, fullContent, thoughtContent, isThinking, hasError);
                } else if (parsed.content) {
                  isThinking = false;
                  fullContent += parsed.content;
                  updateStreamingMessage(streamDiv, fullContent, thoughtContent, isThinking, hasError);
                }
              } catch (_) { /* skip */ }
            }
          }
        }

        // If we got here with some content or thoughts, we consider it a success
        if (fullContent || thoughtContent) {
          // If the model was premium, flag it
          if (isPremiumModel(modelValue)) {
            for (let i = chat.messages.length - 1; i >= 0; i--) {
              if (chat.messages[i].role === 'user') {
                chat.messages[i].usedPremium = true;
                break;
              }
            }
          }

          // Save assistant message
          isThinking = false;
          updateStreamingMessage(streamDiv, fullContent, thoughtContent, isThinking, hasError);
          
          chat.messages.push({ 
            role: 'assistant', 
            content: fullContent,
            thoughts: thoughtContent,
            isError: hasError
          });

          // Add action buttons to the completed message bubble
          addMessageActions(streamDiv, fullContent, chat.messages.length - 1);
          
          success = true;
          break; // Exit the fallbacks loop on success!
        } else {
          throw new Error("Empty response");
        }

      } catch (err) {
        if (err.name === 'AbortError') {
          // User manually stopped generation - do not failover
          lastErrorMsg = 'Generation stopped by user.';
          
          // Save what we have or print stopped message
          fullContent += '\n\n*— Generation stopped —*';
          updateStreamingMessage(streamDiv, fullContent, thoughtContent, isThinking, hasError);
          chat.messages.push({
            role: 'assistant',
            content: fullContent,
            thoughts: thoughtContent,
            isError: hasError
          });
          addMessageActions(streamDiv, fullContent, chat.messages.length - 1);
          success = true;
          break;
        }

        console.warn(`[Failover] Provider ${provider} with model ${model} failed:`, err.message);
        lastErrorMsg = err.message;
        // Continue to try next fallback
      }
    }

    if (!success) {
      const cleanErr = cleanErrorMessage(lastErrorMsg);
      updateStreamingMessage(streamDiv, cleanErr, '', false, true);
      chat.messages.push({
        role: 'assistant',
        content: cleanErr,
        isError: true
      });
    }

    finishGeneration();
    persistAll();
  }

  function stopGenerating() {
    if (abortController) {
      abortController.abort();
    }
  }

  function finishGeneration() {
    isGenerating = false;
    abortController = null;
    sendBtn.style.display = 'flex';
    stopBtn.style.display = 'none';
    sendBtn.disabled = messageInput.value.trim() === '';
  }

  // ─── Settings ──────────────────────────────────────────────────────────
  function applySettings() {
    // Apply model to selector
    const option = modelSelect.querySelector(`option[value="${settings.selectedModel}"]`);
    if (option) {
      modelSelect.value = settings.selectedModel;
      modelSelect.dispatchEvent(new Event('change'));
    }

    // Apply thinking level selector
    if (settings.thinkingLevel) {
      thinkingSelect.value = settings.thinkingLevel;
      thinkingSelect.dispatchEvent(new Event('change'));
    }
  }

  function openSettings() {
    geminiKeyInput.value = settings.geminiKey || '';
    groqKeyInput.value = settings.groqKey || '';
    siliconflowKeyInput.value = settings.siliconflowKey || '';
    googleClientIdInput.value = settings.googleClientId || '';
    systemPromptInput.value = settings.systemPrompt || '';
    temperatureInput.value = settings.temperature;
    maxTokensInput.value = settings.maxTokens;
    settingsModal.style.display = 'flex';
  }

  function closeSettings() {
    settingsModal.style.display = 'none';
  }

  function saveSettings() {
    settings.geminiKey = geminiKeyInput.value.trim();
    settings.groqKey = groqKeyInput.value.trim();
    settings.siliconflowKey = siliconflowKeyInput.value.trim();
    settings.systemPrompt = systemPromptInput.value.trim();
    settings.temperature = parseFloat(temperatureInput.value) || 0.7;
    settings.maxTokens = parseInt(maxTokensInput.value) || 8192;

    const newClientId = googleClientIdInput.value.trim();
    settings.googleClientId = newClientId;

    persistAll();

    // Re-init Google Drive if client ID is provided
    if (newClientId) {
      initGoogleDrive();
    }

    closeSettings();
  }

  // ─── Utilities ─────────────────────────────────────────────────────────
  function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function cleanErrorMessage(errStr) {
    if (!errStr) return 'Unknown error';
    if (typeof errStr !== 'string') {
      try {
        errStr = JSON.stringify(errStr);
      } catch (_) {
        return 'Unknown error';
      }
    }

    // Attempt to locate any JSON substring
    const jsonStart = errStr.indexOf('{');
    if (jsonStart !== -1) {
      const jsonEnd = errStr.lastIndexOf('}');
      if (jsonEnd !== -1 && jsonEnd > jsonStart) {
        const jsonStr = errStr.substring(jsonStart, jsonEnd + 1);
        try {
          const parsed = JSON.parse(jsonStr);
          const prefix = errStr.substring(0, jsonStart).trim().replace(/:$/, '').trim();

          // Extract standard error fields
          let message = '';
          let code = '';
          let status = '';
          let type = '';

          if (parsed.error && typeof parsed.error === 'object') {
            message = parsed.error.message || '';
            code = parsed.error.code || '';
            status = parsed.error.status || '';
            type = parsed.error.type || '';
          } else {
            message = parsed.message || '';
            code = parsed.code || '';
            status = parsed.status || '';
            type = parsed.type || '';
          }

          if (message) {
            let cleanMsg = `**${prefix || 'API Error'}**\n\n`;
            cleanMsg += `> ${message}\n`;
            if (code) cleanMsg += `> \n> **Code:** \`${code}\`  \n`;
            if (status) cleanMsg += `> **Status:** \`${status}\`  \n`;
            if (type) cleanMsg += `> **Type:** \`${type}\`  \n`;
            return cleanMsg + "\n\n💡 *Tip: Try checking your API keys or settings.*";
          }
        } catch (e) {
          // Fall through if JSON parsing of the substring fails
        }
      }
    }

    // Fall back to returning formatted raw text
    return `**API Error**\n\n> ${errStr}\n\n💡 *Tip: Try checking your API keys or settings.*`;
  }

  // ─── Boot ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

})();
