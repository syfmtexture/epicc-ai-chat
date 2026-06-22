/* ═══════════════════════════════════════════════════════════════════════════
   Google Drive Sync Module
   Handles Google Sign-In via GIS (Google Identity Services) and syncing
   chat/settings data to the user's private Google Drive appDataFolder.
   ═══════════════════════════════════════════════════════════════════════════ */

window.DriveSync = (() => {

  const SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';
  const DRIVE_API = 'https://www.googleapis.com/drive/v3';

  let tokenClient = null;
  let accessToken = null;
  let userInfo = null;
  let savedClientId = null;
  let hasDriveScope = false;

  // Callbacks
  let onSignIn = null;
  let onSignOut = null;
  let onSyncStatusChange = null;

  /**
   * Initialize the Google Identity Services token client.
   * @param {string} clientId - Google OAuth Client ID
   * @param {object} callbacks - { onSignIn, onSignOut, onSyncStatusChange }
   */
  function init(clientId, callbacks = {}) {
    if (!clientId) return;

    if (tokenClient && savedClientId === clientId) {
      if (callbacks.onSignIn) onSignIn = callbacks.onSignIn;
      if (callbacks.onSignOut) onSignOut = callbacks.onSignOut;
      if (callbacks.onSyncStatusChange) onSyncStatusChange = callbacks.onSyncStatusChange;
      return;
    }

    savedClientId = clientId;

    if (callbacks.onSignIn) onSignIn = callbacks.onSignIn;
    if (callbacks.onSignOut) onSignOut = callbacks.onSignOut;
    if (callbacks.onSyncStatusChange) onSyncStatusChange = callbacks.onSyncStatusChange;

    // Check if session can be restored
    const savedToken = localStorage.getItem('drive_access_token');
    const savedUserInfo = localStorage.getItem('drive_user_info');
    const savedScope = localStorage.getItem('drive_has_drive_scope');
    const savedExpiry = localStorage.getItem('drive_token_expiry');

    if (savedToken && savedUserInfo && savedExpiry && Date.now() < parseInt(savedExpiry)) {
      accessToken = savedToken;
      try {
        userInfo = JSON.parse(savedUserInfo);
      } catch (e) {
        userInfo = { name: 'User', email: '' };
      }
      hasDriveScope = savedScope === 'true';

      // Defer to allow the calling app to finish binding callbacks/event handlers
      setTimeout(() => {
        if (onSignIn) onSignIn(userInfo);
        setSyncStatus('synced', 'Connected');
      }, 0);
    }

    try {
      if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: handleTokenResponse,
          error_callback: (err) => {
            console.error('[DriveSync] Token error:', err);
            setSyncStatus('error', 'Auth error');
          }
        });
      } else {
        console.warn('[DriveSync] Google Identity Services library not loaded yet. Will initialize when loaded.');
        // Set up listener for window load to try again
        window.addEventListener('load', () => {
          if (!tokenClient && savedClientId) {
            init(savedClientId);
          }
        }, { once: true });
      }
    } catch (err) {
      console.error('[DriveSync] Failed to init GIS:', err);
    }
  }

  /**
   * Trigger the Google Sign-In popup.
   */
  function signIn() {
    if (typeof EpiccBridge !== 'undefined' && EpiccBridge.googleSignIn) {
      setSyncStatus('syncing', 'Connecting natively...');
      EpiccBridge.googleSignIn(savedClientId || '');
      return;
    }

    if (!tokenClient) {
      if (savedClientId && typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
        try {
          tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: savedClientId,
            scope: SCOPES,
            callback: handleTokenResponse,
            error_callback: (err) => {
              console.error('[DriveSync] Token error:', err);
              setSyncStatus('error', 'Auth error');
            }
          });
        } catch (err) {
          console.error('[DriveSync] Failed to init GIS on sign-in:', err);
        }
      }
    }

    if (!tokenClient) {
      if (!savedClientId) {
        alert('Please set your Google OAuth Client ID in Settings first.');
      } else {
        alert('Google Sign-In library is not loaded. If you are using an ad-blocker or privacy extension, please disable it for this site and refresh the page, then try again.');
      }
      return;
    }
    tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  /**
   * Sign out and clear tokens.
   */
  function signOut() {
    if (accessToken && typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      try {
        google.accounts.oauth2.revoke(accessToken, () => {});
      } catch (err) {
        console.error('[DriveSync] Failed to revoke token:', err);
      }
    }
    accessToken = null;
    userInfo = null;
    hasDriveScope = false;
    localStorage.removeItem('drive_access_token');
    localStorage.removeItem('drive_user_info');
    localStorage.removeItem('drive_has_drive_scope');
    localStorage.removeItem('drive_token_expiry');
    if (onSignOut) onSignOut();
  }

  /**
   * Handle the OAuth token response.
   */
  async function handleTokenResponse(response) {
    if (response.error) {
      console.error('[DriveSync] Auth error:', response.error);
      setSyncStatus('error', 'Auth failed');
      return;
    }
    accessToken = response.access_token;

    // Check if drive.appdata scope was granted
    const grantedScopes = response.scope || '';
    hasDriveScope = grantedScopes.includes('https://www.googleapis.com/auth/drive.appdata');

    // Fetch user info
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      userInfo = await res.json();
    } catch (err) {
      console.error('[DriveSync] Failed to get user info:', err);
      userInfo = { name: 'User', email: '' };
    }

    // Save session to localStorage
    localStorage.setItem('drive_access_token', accessToken);
    localStorage.setItem('drive_user_info', JSON.stringify(userInfo));
    localStorage.setItem('drive_has_drive_scope', hasDriveScope ? 'true' : 'false');
    localStorage.setItem('drive_token_expiry', (Date.now() + 3600 * 1000).toString());

    if (onSignIn) onSignIn(userInfo);
    setSyncStatus('synced', 'Connected');
  }

  /**
   * Check if user is currently signed in.
   */
  function isSignedIn() {
    return !!accessToken;
  }

  /**
   * Get current user info.
   */
  function getUserInfo() {
    return userInfo;
  }

  /**
   * Check if user granted Drive permissions.
   */
  function hasDrivePermission() {
    return !!accessToken && hasDriveScope;
  }

  // ─── Drive File Operations ──────────────────────────────────────────────

  /**
   * Find a file by name in appDataFolder.
   * @returns {string|null} file ID or null
   */
  async function findFile(name) {
    try {
      const res = await fetch(
        `${DRIVE_API}/files?spaces=appDataFolder&q=name='${name}'&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (res.status === 401) {
        signOut();
        return null;
      }
      const data = await res.json();
      return data.files && data.files.length > 0 ? data.files[0].id : null;
    } catch (err) {
      console.error('[DriveSync] findFile error:', err);
      return null;
    }
  }

  /**
   * Read a file's content from appDataFolder.
   * @returns {object|null} parsed JSON or null
   */
  async function readFile(fileId) {
    try {
      const res = await fetch(
        `${DRIVE_API}/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (res.status === 401) {
        signOut();
        return null;
      }
      return await res.json();
    } catch (err) {
      console.error('[DriveSync] readFile error:', err);
      return null;
    }
  }

  /**
   * Create a new file in appDataFolder.
   * @returns {string|null} file ID
   */
  async function createFile(name, content) {
    try {
      const metadata = {
        name,
        parents: ['appDataFolder'],
        mimeType: 'application/json'
      };

      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', new Blob([JSON.stringify(content)], { type: 'application/json' }));

      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form
        }
      );
      if (res.status === 401) {
        signOut();
        return null;
      }
      const data = await res.json();
      return data.id || null;
    } catch (err) {
      console.error('[DriveSync] createFile error:', err);
      return null;
    }
  }

  /**
   * Update an existing file's content.
   */
  async function updateFile(fileId, content) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(content)
        }
      );
      if (res.status === 401) {
        signOut();
      }
    } catch (err) {
      console.error('[DriveSync] updateFile error:', err);
    }
  }

  // ─── High-Level Sync ────────────────────────────────────────────────────

  /**
   * Save data to a named file in appDataFolder (create or update).
   */
  async function saveData(filename, data) {
    if (!accessToken) return;
    setSyncStatus('syncing', 'Syncing...');
    try {
      const fileId = await findFile(filename);
      if (fileId) {
        await updateFile(fileId, data);
      } else {
        await createFile(filename, data);
      }
      setSyncStatus('synced', 'Synced');
    } catch (err) {
      console.error('[DriveSync] saveData error:', err);
      setSyncStatus('error', 'Sync failed');
    }
  }

  /**
   * Load data from a named file in appDataFolder.
   * @returns {object|null}
   */
  async function loadData(filename) {
    if (!accessToken) return null;
    setSyncStatus('syncing', 'Loading...');
    try {
      const fileId = await findFile(filename);
      if (!fileId) {
        setSyncStatus('synced', 'Synced');
        return null;
      }
      const data = await readFile(fileId);
      setSyncStatus('synced', 'Synced');
      return data;
    } catch (err) {
      console.error('[DriveSync] loadData error:', err);
      setSyncStatus('error', 'Load failed');
      return null;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  function setSyncStatus(state, text) {
    if (onSyncStatusChange) onSyncStatusChange(state, text);
  }

  /**
   * Called by native Android bridge on successful sign in
   */
  async function onNativeSignInSuccess(token, email, name, picture) {
    accessToken = token;
    userInfo = {
      email: email || '',
      name: name || 'User',
      picture: picture || ''
    };
    hasDriveScope = true; // Native flow grants requested scopes

    // Save session to localStorage
    localStorage.setItem('drive_access_token', accessToken);
    localStorage.setItem('drive_user_info', JSON.stringify(userInfo));
    localStorage.setItem('drive_has_drive_scope', 'true');
    localStorage.setItem('drive_token_expiry', (Date.now() + 3600 * 1000).toString());

    if (onSignIn) {
      await onSignIn(userInfo);
    }
    setSyncStatus('synced', 'Connected (Mobile)');
  }

  /**
   * Called by native Android bridge on sign in error
   */
  function onNativeSignInError(errMessage) {
    console.error('[DriveSync] Native auth error:', errMessage);
    setSyncStatus('error', errMessage || 'Native sign-in failed');
  }

  return {
    init,
    signIn,
    signOut,
    isSignedIn,
    hasDrivePermission,
    getUserInfo,
    saveData,
    loadData,
    onNativeSignInSuccess,
    onNativeSignInError
  };

})();
