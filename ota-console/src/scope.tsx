import { createContext, useContext } from 'react';
import type { AppId } from './lib/api';

export const ScopeContext = createContext<{ app: AppId; setApp: (a: AppId) => void }>({
  app: 'user',
  setApp: () => {},
});

export const useScope = () => useContext(ScopeContext);
