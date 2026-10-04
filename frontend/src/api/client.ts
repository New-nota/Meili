export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown) {
        super(`API ${status}`);
        this.name = "ApiError";
        this.status = status;
        this.body = body;
    }
}

// --- Access-токен живёт в памяти (S8 WP-1), не в localStorage.
// Сессию между перезагрузками держит httpOnly refresh-cookie.
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
    accessToken = token;
}

export function getAccessToken(): string | null {
    return accessToken;
}

// QA: refresh — single-flight. Refresh-токен одноразовый (ротация jti), а
// звать его хотят пачкой: StrictMode дважды запускает bootstrap-эффект,
// TripPlanner шлёт 4-5 запросов разом, и все ловят 401 при протухшем access.
// Каждый слал свой refresh со ОДНОЙ кукой — лишние ротации, а при неудачном
// тайминге «reuse detected» и вылет из всех сессий. Теперь параллельные
// вызовы делят один запрос.
let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
    try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
            method: "POST",
            credentials: "include",
        });
        if (!res.ok) return false;
        const data = await res.json();
        setAccessToken(data.access_token);
        return true;
    } catch {
        return false;
    }
}

/** Обновить access по refresh-cookie. true = сессия жива. */
export function tryRefresh(): Promise<boolean> {
    if (!refreshInFlight) {
        refreshInFlight = doRefresh().finally(() => { refreshInFlight = null; });
    }
    return refreshInFlight;
}

export async function logout(): Promise<void> {
    try {
        await fetch(`${API_URL}/auth/logout`, {
            method: "POST",
            credentials: "include",
        });
    } finally {
        setAccessToken(null);
    }
}

// apiFetch — ТОЛЬКО для нашего API: шлёт cookie и Authorization.
// Сторонние сервисы (Nominatim и т.п.) — сырой fetch без credentials.
export async function apiFetch<T = unknown>(
    path: string,
    options: RequestInit = {},
): Promise<T> {
    const doFetch = () => {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...(options.headers as Record<string, string> | undefined),
        };
        if (accessToken) {
            headers["Authorization"] = `Bearer ${accessToken}`;
        }
        return fetch(`${API_URL}${path}`, {
            ...options,
            headers,
            credentials: "include",
        });
    };

    let res = await doFetch();

    // молчаливый refresh: одна попытка, и не для /auth/* — там 401 значит
    // «неверный пароль/код», а не «протух access». QA: неудачный логин при
    // живой куке ПРОШЛОГО юзера молча рефрешил его сессию — экран говорил
    // «неверный пароль», а в памяти уже лежал чужой access.
    if (res.status === 401 && !path.startsWith("/auth/")) {
        if (await tryRefresh()) {
            res = await doFetch();
        } else {
            setAccessToken(null);
            if (window.location.pathname !== "/auth") {
                window.location.href = "/auth";
            }
        }
    }

    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, body);
    }
    if (res.status === 204) {
        return undefined as T;
    }
    return res.json() as Promise<T>
}
