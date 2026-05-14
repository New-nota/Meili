import type React from "react";
import { Children } from "react";
import { Navigate } from "react-router-dom";

export default function ProtectedRoute({ children }: { children: React.ReactNode}){
    const token = localStorage.getItem('access_token')
    if (!token) return <Navigate to="/auth" replace />
    return <>{children}</>
}