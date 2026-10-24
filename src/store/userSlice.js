import { createSlice } from '@reduxjs/toolkit';

const SESSION_CACHE_KEY = 'dana_foundry_user_session';

const loadCachedUser = () => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = localStorage.getItem(SESSION_CACHE_KEY);
      if (stored) return JSON.parse(stored);
    }
  } catch {}
  return null;
};

const cachedUser = loadCachedUser();

const userSlice = createSlice({
  name: 'user',
  initialState: {
    user: cachedUser,
    isAuthenticated: Boolean(cachedUser),
    isInitialized: Boolean(cachedUser),
  },
  reducers: {
    setUser(state, action) {
      const raw = action.payload;
      if (!raw) {
        state.user = null;
        state.isAuthenticated = false;
        state.isInitialized = true;
        return;
      }
      state.user = JSON.parse(JSON.stringify(raw));
      state.isAuthenticated = true;
      state.isInitialized = true;
    },
    clearUser(state) {
      state.user = null;
      state.isAuthenticated = false;
      state.isInitialized = true;
    },
    setInitialized(state) {
      state.isInitialized = true;
    },
  },
});

export const { setUser, clearUser, setInitialized } = userSlice.actions;
export default userSlice.reducer;
