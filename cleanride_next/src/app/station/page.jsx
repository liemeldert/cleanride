'use client';

import { SessionProvider } from 'next-auth/react';
import Navbar from '../../components/Navbar';
import StationView from '../../components/StationView';

export default function StationPage() {
  return (
    <SessionProvider>
      <div className="min-h-screen bg-gray-100">
        <StationView />
        <Navbar />
      </div>
    </SessionProvider>
  );
}
