import mongoose from 'mongoose';

// Schema for child stops (platform-level details)
const ChildStopSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  location: {
    lat: {
      type: Number,
      required: true
    },
    lon: {
      type: Number,
      required: true
    }
  }
}, { _id: false });

// Main station schema
const StationSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    index: true
  },
  location: {
    lat: {
      type: Number,
      required: true,
      index: true
    },
    lon: {
      type: Number,
      required: true,
      index: true
    }
  },
  lines: {
    type: [String],
    default: [],
    index: true
  },
  location_type: {
    type: Number,
    default: 1,
    // 0: stop/platform, 1: station, 2: entrance/exit, 3: generic node, 4: boarding area
  },
  wheelchair_boarding: {
    type: Number,
    default: 0,
    // 0: no info, 1: accessible, 2: not accessible
  },
  child_stops: {
    type: [ChildStopSchema],
    default: []
  },
  data_type: {
    type: String,
    enum: ['regular', 'special', 'temporary'],
    default: 'regular'
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, { 
  timestamps: { 
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  collection: 'gtfs_processed_stations' // Use the existing collection name
});

// Create spatial index for location-based queries
StationSchema.index({ 'location.lat': 1, 'location.lon': 1 });

// Compound index for line-based queries with location
StationSchema.index({ lines: 1, 'location.lat': 1, 'location.lon': 1 });

// Create text index for station name searches
StationSchema.index({ name: 'text' });

// Method to calculate distance from a given point
StationSchema.methods.getDistanceFrom = function(lat, lon) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat - this.location.lat);
  const dLon = deg2rad(lon - this.location.lon);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(this.location.lat)) * Math.cos(deg2rad(lat)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  const distance = R * c * 1000; // Distance in meters
  
  return distance;
};

// Helper function for getDistanceFrom
function deg2rad(deg) {
  return deg * (Math.PI/180);
}

// Static method to find stations near a point
StationSchema.statics.findNearby = async function(lat, lon, maxDistance = 1000, limit = 10) {
  // Find stations within maxDistance meters of the given point
  const stations = await this.find({
    location: {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: [lon, lat] // GeoJSON format is [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    }
  }).limit(limit);
  
  // Calculate exact distance for each station and add to result
  return stations.map(station => {
    const stationObj = station.toObject();
    stationObj.distance = station.getDistanceFrom(lat, lon);
    return stationObj;
  }).sort((a, b) => a.distance - b.distance);
};

// Check if model already exists to prevent overwriting during hot reloads
const Station = mongoose.models.Station || mongoose.model('Station', StationSchema);

export default Station;