"use client";
import { useUser } from "@clerk/nextjs";
import Image from "next/image";
import { useState } from "react";

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function NoAuthProfile() {
  return (
    <div className="container profile-card action-card">
      <h2 className="profile-name">Auth not configured</h2>
      <p className="profile-email">
        Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY to enable profiles.
      </p>
    </div>
  );
}

function ClerkProfile() {
  const { user, isLoaded } = useUser();

  const fallbackSrc = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%2363b3ed'/%3E%3Cpath d='M50 45c7.5 0 13.64-6.14 13.64-13.64S57.5 17.72 50 17.72s-13.64 6.14-13.64 13.64S42.5 45 50 45zm0 6.82c-9.09 0-27.28 4.56-27.28 13.64v3.41c0 1.88 1.53 3.41 3.41 3.41h47.74c1.88 0 3.41-1.53 3.41-3.41v-3.41c0-9.08-18.19-13.64-27.28-13.64z' fill='%23fff'/%3E%3C/svg%3E`;

  const picture = user?.imageUrl ?? null;
  const [failedPicture, setFailedPicture] = useState<string | null>(null);

  const imgSrc = picture && failedPicture !== picture ? picture : fallbackSrc;

  if (!isLoaded) {
    return (
      <div className="loading-state">
        <div className="loading-text">Loading user profile...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="container profile-card action-card">
      <Image
        src={imgSrc}
        alt={user.fullName || "User profile"}
        className="profile-picture"
        width={100}
        height={100}
        sizes="100px"
        unoptimized
        onError={() => setFailedPicture(picture)}
      />
      <h2 className="profile-name">{user.fullName}</h2>
      <p className="profile-email">{user.primaryEmailAddress?.emailAddress}</p>
    </div>
  );
}

export default function Profile() {
  return hasClerk ? <ClerkProfile /> : <NoAuthProfile />;
}
