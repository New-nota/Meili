import type React from "react";
import { Navigate } from "react-router-dom";
import { getAccessToken } from "../api/client";
import EveningSurvey from "./EveningSurvey";

// Доступ решается по access-токену в памяти; к этому моменту App уже
// сделал bootstrap-refresh (S8 WP-1), так что состояние актуально.
export default function ProtectedRoute({ children }: { children: React.ReactNode}){
    if (!getAccessToken()) return <Navigate to="/auth" replace />
    return (
        <>
            {children}
            {/* S15: вечерний опрос «как вам день» — на любой авторизованной странице */}
            <EveningSurvey />
        </>
    )
}
