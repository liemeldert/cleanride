import { getCurrentPosition } from '../lib/geoLocation';

export async function detectUserTrain() {
  try {
    // Get current position 
    const position = await getCurrentPosition();
    
    const response = await fetch('/api/train-detection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to detect train');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error detecting train:', error);
    throw error;
  }
}