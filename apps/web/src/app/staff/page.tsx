"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { StaffGate, useStaff } from "@/lib/staff-auth";

function Redirect() {
  const { me, can } = useStaff();
  const router = useRouter();
  useEffect(() => {
    router.replace(me.role === "kitchen" ? "/staff/kitchen" : can("tables.view") ? "/staff/floor" : "/staff/admin");
  }, [me, can, router]);
  return null;
}
export default function StaffHome() {
  return (
    <StaffGate>
      <Redirect />
    </StaffGate>
  );
}
