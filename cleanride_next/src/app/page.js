import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-50">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-2">Cleanride</h1>
        <p className="text-center text-gray-600 mb-8">
          Help improve NYC subway experience by reporting cleanliness and safety issues
        </p>
        
        <div className="space-y-4">
          <Link href="/station" className="block w-full p-4 bg-mta-blue text-white text-center rounded-lg shadow">
            <div className="text-xl mb-1">Station View</div>
            <div className="text-sm">Check ratings of incoming trains</div>
          </Link>
          
          <Link href="/train" className="block w-full p-4 bg-mta-green text-white text-center rounded-lg shadow">
            <div className="text-xl mb-1">Train View</div>
            <div className="text-sm">Report issues on your current train</div>
          </Link>
        </div>
        
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Crowdsourced data to make NYC subway better</p>
        </div>
      </div>
    </div>
  );
}
