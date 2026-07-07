export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
    constructor(public status: number, public body: unknown) {
        super(`API ${status}`);
        this.name = "ApiError";
    }
}

export async function apiFetch<T = unknown>(
    path: string,
    options: RequestInit = {},
): Promise<T> {
    const token = localStorage.getItem("access_token");

    const headers: Record<string, string> = {
        "Content-Type":"application/json",
        ...(options.headers as Record<string, string> | undefined),
    };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    const res = await fetch(`${API_URL}${path}`, {...options, headers});

    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, body);
    }
    if (res.status === 204) {
        return undefined as T;
    }
    return res.json() as Promise<T>
}