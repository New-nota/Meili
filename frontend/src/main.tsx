import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './styles/tokens.css' // токены Meili — первыми, до index.css (S10)
import './i18n' // до рендера: язык должен быть готов к первому кадру (S9 WP-C)
import './index.css'
import App from './App.tsx'
const queryClient = new QueryClient
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
    
  </StrictMode>,
)
