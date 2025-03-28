export function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (typeof window !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          },
          (error) => {
            reject(error);
          },
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 }
        );
      } else {
        reject(new Error('Geolocation is not supported by this browser.'));
      }
    });
  }
  