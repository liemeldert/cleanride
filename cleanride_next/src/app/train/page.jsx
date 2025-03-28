'use client';

import { SessionProvider } from 'next-auth/react';
import Navbar from '../../components/Navbar';
import TrainView from '../../components/TrainView';

export default function TrainPage() {
  return (
    <SessionProvider>
      <div className="min-h-screen bg-gray-100">
        <TrainView />
        <Navbar />
      </div>
    </SessionProvider>
  );
}
