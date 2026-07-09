import type React from "react";
import { Navigate } from "react-router-dom";
import { getAccessToken } from "../api/client";

// Доступ решается по access-токену в памяти; к этому моменту App уже
// сделал bootstrap-refresh (S8 WP-1), так что состояние актуально.
export default function ProtectedRoute({ children }: { children: React.ReactNode}){
    if (!getAccessToken()) return <Navigate to="/auth" replace />
    return <>{children}</>
}
