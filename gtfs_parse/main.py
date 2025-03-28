#!/usr/bin/env python3
"""
MTA GTFS Data Processor

This script downloads and processes MTA GTFS data and saves it to MongoDB for use by the
MTA Cleanliness Tracker application.

Usage:
    python gtfs_processor.py [--regular | --supplemented]

Options:
    --regular       Process regular GTFS data (default)
    --supplemented  Process supplemented GTFS data with service changes
"""

import os
import io
import sys
import csv
import time
import zipfile
import logging
import argparse
import datetime
import requests
import pymongo
from typing import Dict, List, Any, Optional, Set, Tuple
import pandas as pd
from pymongo import MongoClient
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("gtfs_processor")

# Load environment variables
load_dotenv()

# MongoDB connection string
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://root:securepassword@localhost:27017/cleanride")
# MONGO_HOST = "localhost" 
# MONGO_PORT = "27017"
# MONGO_DB = "cleanride"
# MONGO_USER = "root"
# MONGO_PASS = "securepassword"

# MONGODB_URI = "mongodb://{}:{}@{}:{}/{}?authSource=admin".format(MONGO_USER, MONGO_PASS, MONGO_HOST, MONGO_PORT, MONGO_DB)

# GTFS URLs
REGULAR_GTFS_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip"
SUPPLEMENTED_GTFS_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_supplemented.zip"

# Define collections
COLLECTIONS = {
    "agencies": "gtfs_agencies",
    "routes": "gtfs_routes",
    "stops": "gtfs_stops", 
    "trips": "gtfs_trips",
    "stop_times": "gtfs_stop_times",
    "calendar": "gtfs_calendar",
    "transfers": "gtfs_transfers",
    "shapes": "gtfs_shapes",
    "processed_stations": "gtfs_processed_stations",
    "metadata": "gtfs_metadata"
}

class GTFSProcessor:
    """Process GTFS data and save to MongoDB"""
    
    def __init__(self, db_uri: str, is_supplemented: bool = False):
        """Initialize the processor
        
        Args:
            db_uri: MongoDB connection URI
            is_supplemented: Whether to process supplemented GTFS data
        """
        self.db_uri = db_uri
        self.is_supplemented = is_supplemented
        self.gtfs_url = SUPPLEMENTED_GTFS_URL if is_supplemented else REGULAR_GTFS_URL
        self.client = MongoClient(db_uri)
        self.db = self.client.get_database()
        self.data_type = "supplemented" if is_supplemented else "regular"
        
        # Create indexes for collections if they don't exist
        self._ensure_indexes()
        
    def _ensure_indexes(self):
        """Create indexes for collections if they don't exist"""
        logger.info("Ensuring indexes exist on collections")
        
        # Create stop_id index on stops collection
        self.db[COLLECTIONS["stops"]].create_index("stop_id", unique=True)
        
        # Create route_id index on routes collection
        self.db[COLLECTIONS["routes"]].create_index("route_id", unique=True)
        
        # Create trip_id index on trips collection
        self.db[COLLECTIONS["trips"]].create_index("trip_id", unique=True)
        
        # Create compound index on stop_times collection
        self.db[COLLECTIONS["stop_times"]].create_index(
            [("trip_id", pymongo.ASCENDING), ("stop_sequence", pymongo.ASCENDING)],
        )
        
        # Create stop_id index on stop_times for efficient lookups
        self.db[COLLECTIONS["stop_times"]].create_index("stop_id")
        
        # Create service_id index on calendar
        self.db[COLLECTIONS["calendar"]].create_index("service_id", unique=True)
        
        # Create unique index on processed_stations
        self.db[COLLECTIONS["processed_stations"]].create_index("id", unique=True)
        
    def download_gtfs(self) -> bytes:
        """Download the GTFS zip file
        
        Returns:
            The GTFS zip file content
        """
        logger.info(f"Downloading GTFS data from {self.gtfs_url}")
        response = requests.get(self.gtfs_url)
        response.raise_for_status()
        return response.content
        
    def process_gtfs(self):
        """Process the GTFS data and save to MongoDB"""
        start_time = time.time()
        logger.info(f"Starting GTFS data processing for {self.data_type} data")
        
        # Download the GTFS zip file
        zip_content = self.download_gtfs()
        
        # Process the zip file
        with zipfile.ZipFile(io.BytesIO(zip_content)) as zip_file:
            # Get list of files in the zip
            files = zip_file.namelist()
            logger.info(f"Files in GTFS zip: {', '.join(files)}")
            
            # Process each file
            self._process_agency(zip_file, "agency.txt")
            routes = self._process_routes(zip_file, "routes.txt")
            stops = self._process_stops(zip_file, "stops.txt")
            calendar = self._process_calendar(zip_file, "calendar.txt")
            self._process_shapes(zip_file, "shapes.txt")
            trips = self._process_trips(zip_file, "trips.txt")
            self._process_stop_times(zip_file, "stop_times.txt")
            self._process_transfers(zip_file, "transfers.txt")
            
            # Process stations (parent stops and their child stops)
            self._process_stations(stops, routes, trips)
            
        # Update metadata
        self._update_metadata()
        
        end_time = time.time()
        processing_time = end_time - start_time
        logger.info(f"GTFS data processing completed in {processing_time:.2f} seconds")
    
    def _process_agency(self, zip_file: zipfile.ZipFile, filename: str):
        """Process agency.txt and save to MongoDB"""
        logger.info(f"Processing {filename}")
        collection = self.db[COLLECTIONS["agencies"]]
        
        # Drop existing documents for this data type
        collection.delete_many({"data_type": self.data_type})
        
        # Read and parse the file
        with zip_file.open(filename) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
            agencies = []
            
            for row in reader:
                agency = {
                    "agency_id": row.get("agency_id", "MTA"),
                    "agency_name": row.get("agency_name", ""),
                    "agency_url": row.get("agency_url", ""),
                    "agency_timezone": row.get("agency_timezone", ""),
                    "agency_lang": row.get("agency_lang", ""),
                    "agency_phone": row.get("agency_phone", ""),
                    "data_type": self.data_type,
                    "updated_at": datetime.datetime.utcnow()
                }
                agencies.append(agency)
            
            # Insert agencies
            if agencies:
                collection.insert_many(agencies)
                logger.info(f"Inserted {len(agencies)} agencies")
    
    def _process_routes(self, zip_file: zipfile.ZipFile, filename: str) -> Dict[str, Dict]:
        """Process routes.txt and save to MongoDB
        
        Returns:
            Dictionary of routes keyed by route_id
        """
        logger.info(f"Processing {filename}")
        collection = self.db[COLLECTIONS["routes"]]
        
        # Drop existing documents for this data type
        collection.delete_many({"data_type": self.data_type})
        
        # Read and parse the file
        routes_dict = {}
        with zip_file.open(filename) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
            routes = []
            
            for row in reader:
                route = {
                    "route_id": row.get("route_id", ""),
                    "agency_id": row.get("agency_id", ""),
                    "route_short_name": row.get("route_short_name", ""),
                    "route_long_name": row.get("route_long_name", ""),
                    "route_desc": row.get("route_desc", ""),
                    "route_type": int(row.get("route_type", 0)),
                    "route_url": row.get("route_url", ""),
                    "route_color": row.get("route_color", ""),
                    "route_text_color": row.get("route_text_color", ""),
                    "data_type": self.data_type,
                    "updated_at": datetime.datetime.utcnow()
                }
                routes.append(route)
                routes_dict[route["route_id"]] = route
            
            # Insert routes
            if routes:
                collection.insert_many(routes)
                logger.info(f"Inserted {len(routes)} routes")
        
        return routes_dict
    
    def _process_stops(self, zip_file: zipfile.ZipFile, filename: str) -> Dict[str, Dict]:
        """Process stops.txt and save to MongoDB
        
        Returns:
            Dictionary of stops keyed by stop_id
        """
        logger.info(f"Processing {filename}")
        collection = self.db[COLLECTIONS["stops"]]
        
        # Drop existing documents for this data type
        collection.delete_many({"data_type": self.data_type})
        
        # Read and parse the file
        stops_dict = {}
        with zip_file.open(filename) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
            stops = []
            
            for row in reader:
                stop = {
                    "stop_id": row.get("stop_id", ""),
                    "stop_code": row.get("stop_code", ""),
                    "stop_name": row.get("stop_name", ""),
                    "stop_desc": row.get("stop_desc", ""),
                    "stop_lat": float(row.get("stop_lat", 0)),
                    "stop_lon": float(row.get("stop_lon", 0)),
                    "zone_id": row.get("zone_id", ""),
                    "stop_url": row.get("stop_url", ""),
                    "location_type": int(row.get("location_type", 0)) if row.get("location_type", "").isdigit() else 0,
                    "parent_station": row.get("parent_station", ""),
                    "wheelchair_boarding": int(row.get("wheelchair_boarding", 0)) if row.get("wheelchair_boarding") else 0,
                    "data_type": self.data_type,
                    "updated_at": datetime.datetime.utcnow()
                }
                stops.append(stop)
                stops_dict[stop["stop_id"]] = stop
            
            # Insert stops
            if stops:
                collection.insert_many(stops)
                logger.info(f"Inserted {len(stops)} stops")
        
        return stops_dict
    
    def _process_calendar(self, zip_file: zipfile.ZipFile, filename: str) -> Dict[str, Dict]:
        """Process calendar.txt and save to MongoDB
        
        Returns:
            Dictionary of calendar entries keyed by service_id
        """
        logger.info(f"Processing {filename}")
        collection = self.db[COLLECTIONS["calendar"]]
        
        # Drop existing documents for this data type
        collection.delete_many({"data_type": self.data_type})
        
        # Read and parse the file
        calendar_dict = {}
        with zip_file.open(filename) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
            calendar_entries = []
            
            for row in reader:
                calendar_entry = {
                    "service_id": row.get("service_id", ""),
                    "monday": int(row.get("monday", 0)),
                    "tuesday": int(row.get("tuesday", 0)),
                    "wednesday": int(row.get("wednesday", 0)),
                    "thursday": int(row.get("thursday", 0)),
                    "friday": int(row.get("friday", 0)),
                    "saturday": int(row.get("saturday", 0)),
                    "sunday": int(row.get("sunday", 0)),
                    "start_date": row.get("start_date", ""),
                    "end_date": row.get("end_date", ""),
                    "data_type": self.data_type,
                    "updated_at": datetime.datetime.utcnow()
                }
                calendar_entries.append(calendar_entry)
                calendar_dict[calendar_entry["service_id"]] = calendar_entry
            
            # Insert calendar entries
            if calendar_entries:
                collection.insert_many(calendar_entries)
                logger.info(f"Inserted {len(calendar_entries)} calendar entries")
        
        return calendar_dict
    
    def _process_shapes(self, zip_file: zipfile.ZipFile, filename: str):
        """Process shapes.txt and save to MongoDB"""
        logger.info(f"Processing {filename}")
        collection = self.db[COLLECTIONS["shapes"]]
        
        # Drop existing documents for this data type
        collection.delete_many({"data_type": self.data_type})
        
        # Process in chunks to avoid memory issues
        chunk_size = 10000
        shapes = []
        count = 0
        
        with zip_file.open(filename) as f:
            # Use pandas to read file in chunks
            for chunk in pd.read_csv(f, chunksize=chunk_size):
                # Convert chunk to dictionaries
                records = chunk.to_dict(orient='records')
                
                # Add metadata to each record
                for record in records:
                    record['data_type'] = self.data_type
                    record['updated_at'] = datetime.datetime.utcnow()
                    
                    # Ensure numeric fields are properly typed
                    record['shape_pt_lat'] = float(record.get('shape_pt_lat', 0))
                    record['shape_pt_lon'] = float(record.get('shape_pt_lon', 0))
                    record['shape_pt_sequence'] = int(record.get('shape_pt_sequence', 0))
                    if 'shape_dist_traveled' in record and record['shape_dist_traveled']:
                        record['shape_dist_traveled'] = float(record['shape_dist_traveled'])
                
                # Append to shapes list
                shapes.extend(records)
                count += len(records)
                
                # Insert in batches to avoid memory issues
                if len(shapes) >= chunk_size:
                    collection.insert_many(shapes)
                    shapes = []
                    logger.info(f"Inserted {count} shape points so far...")
            
            # Insert any remaining shapes
            if shapes:
                collection.insert_many(shapes)
            
            logger.info(f"Inserted total of {count} shape points")
        
        # Create index on shape_id and sequence for efficient querying
        collection.create_index([
            ("shape_id", pymongo.ASCENDING),
            ("shape_pt_sequence", pymongo.ASCENDING)
        ])
    
    def _process_trips(self, zip_file: zipfile.ZipFile, filename: str) -> Dict[str, Dict]:
        """Process trips.txt and save to MongoDB
        
        Returns:
            Dictionary of trips keyed by trip_id
        """
        logger.info(f"Processing {filename}")
        collection = self.db[COLLECTIONS["trips"]]
        
        # Drop existing documents for this data type
        collection.delete_many({"data_type": self.data_type})
        
        # Read and parse the file
        trips_dict = {}
        with zip_file.open(filename) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
            trips = []
            
            for row in reader:
                trip = {
                    "route_id": row.get("route_id", ""),
                    "service_id": row.get("service_id", ""),
                    "trip_id": row.get("trip_id", ""),
                    "trip_headsign": row.get("trip_headsign", ""),
                    "trip_short_name": row.get("trip_short_name", ""),
                    "direction_id": int(row.get("direction_id", 0)) if row.get("direction_id") else 0,
                    "block_id": row.get("block_id", ""),
                    "shape_id": row.get("shape_id", ""),
                    "wheelchair_accessible": int(row.get("wheelchair_accessible", 0)) if row.get("wheelchair_accessible") else 0,
                    "data_type": self.data_type,
                    "updated_at": datetime.datetime.utcnow()
                }
                trips.append(trip)
                trips_dict[trip["trip_id"]] = trip
            
            # Insert trips
            if trips:
                collection.insert_many(trips)
                logger.info(f"Inserted {len(trips)} trips")
        
        return trips_dict
    
    def _process_stop_times(self, zip_file: zipfile.ZipFile, filename: str):
        """Process stop_times.txt and save to MongoDB"""
        logger.info(f"Processing {filename}")
        collection = self.db[COLLECTIONS["stop_times"]]
        
        # Drop existing documents for this data type
        collection.delete_many({"data_type": self.data_type})
        
        # Process in chunks to avoid memory issues
        chunk_size = 50000
        count = 0
        
        with zip_file.open(filename) as f:
            # Use pandas to read file in chunks
            for chunk in pd.read_csv(f, chunksize=chunk_size):
                # Convert chunk to dictionaries
                stop_times = chunk.to_dict(orient='records')
                
                # Add metadata to each record
                for stop_time in stop_times:
                    stop_time['data_type'] = self.data_type
                    stop_time['updated_at'] = datetime.datetime.utcnow()
                    
                    # Ensure numeric fields are properly typed
                    stop_time['stop_sequence'] = int(stop_time.get('stop_sequence', 0))
                    if 'pickup_type' in stop_time and stop_time['pickup_type']:
                        stop_time['pickup_type'] = int(stop_time['pickup_type'])
                    if 'drop_off_type' in stop_time and stop_time['drop_off_type']:
                        stop_time['drop_off_type'] = int(stop_time['drop_off_type'])
                    if 'shape_dist_traveled' in stop_time and stop_time['shape_dist_traveled']:
                        stop_time['shape_dist_traveled'] = float(stop_time['shape_dist_traveled'])
                
                # Insert the chunk
                collection.insert_many(stop_times)
                count += len(stop_times)
                logger.info(f"Inserted {count} stop times so far...")
            
            logger.info(f"Inserted total of {count} stop times")
    
    def _process_transfers(self, zip_file: zipfile.ZipFile, filename: str):
        """Process transfers.txt and save to MongoDB"""
        logger.info(f"Processing {filename}")
        collection = self.db[COLLECTIONS["transfers"]]
        
        # Drop existing documents for this data type
        collection.delete_many({"data_type": self.data_type})
        
        # Read and parse the file
        with zip_file.open(filename) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
            transfers = []
            
            for row in reader:
                transfer = {
                    "from_stop_id": row.get("from_stop_id", ""),
                    "to_stop_id": row.get("to_stop_id", ""),
                    "transfer_type": int(row.get("transfer_type", 0)),
                    "min_transfer_time": int(row.get("min_transfer_time", 0)) if row.get("min_transfer_time") else None,
                    "data_type": self.data_type,
                    "updated_at": datetime.datetime.utcnow()
                }
                transfers.append(transfer)
            
            # Insert transfers
            if transfers:
                collection.insert_many(transfers)
                logger.info(f"Inserted {len(transfers)} transfers")
    
    def _process_stations(self, stops: Dict[str, Dict], routes: Dict[str, Dict], trips: Dict[str, Dict]):
        """Process stations (parent stops and their child stops)
        
        Args:
            stops: Dictionary of stops
            routes: Dictionary of routes
            trips: Dictionary of trips
        """
        logger.info("Processing stations")
        collection = self.db[COLLECTIONS["processed_stations"]]
        stop_times_collection = self.db[COLLECTIONS["stop_times"]]
        
        # Drop existing documents for this data type
        collection.delete_many({"data_type": self.data_type})
        
        # Get parent stations (stops with location_type=1)
        parent_stations = {
            stop_id: stop for stop_id, stop in stops.items()
            if stop.get("location_type") == 1
        }
        
        # Also include standalone stops (stops with no parent_station)
        standalone_stops = {
            stop_id: stop for stop_id, stop in stops.items()
            if not stop.get("parent_station") and stop.get("location_type") == 0
        }
        
        # Combine parent stations and standalone stops
        stations = {}
        stations.update(parent_stations)
        stations.update(standalone_stops)
        
        # For each station, find its child stops and the routes that serve it
        processed_stations = []
        
        for station_id, station in stations.items():
            # Find child stops
            child_stops = []
            if station.get("location_type") == 1:
                child_stops = [
                    stop for stop_id, stop in stops.items()
                    if stop.get("parent_station") == station_id
                ]
            
            # Get all stop IDs associated with this station (including the station itself if it's a standalone stop)
            station_stop_ids = [child["stop_id"] for child in child_stops]
            if station.get("location_type") == 0:  # If it's a standalone stop
                station_stop_ids.append(station_id)
            
            # Find routes that serve this station by looking at stop_times
            route_ids = set()
            
            # Query stop_times for these stops
            for stop_id in station_stop_ids:
                # Get trip_ids for this stop
                cursor = stop_times_collection.find(
                    {"stop_id": stop_id, "data_type": self.data_type},
                    {"trip_id": 1}
                ).limit(1000)  # Limit to prevent excessive processing
                
                trip_ids = [doc["trip_id"] for doc in cursor]
                
                # Get route_ids for these trips
                for trip_id in trip_ids:
                    if trip_id in trips:
                        route_id = trips[trip_id]["route_id"]
                        route_ids.add(route_id)
            
            # Create processed station object
            processed_station = {
                "id": station_id,
                "name": station.get("stop_name", ""),
                "location": {
                    "lat": station.get("stop_lat"),
                    "lon": station.get("stop_lon")
                },
                "lines": list(route_ids),
                "location_type": station.get("location_type"),
                "wheelchair_boarding": station.get("wheelchair_boarding"),
                "child_stops": [
                    {
                        "id": child.get("stop_id"),
                        "name": child.get("stop_name", ""),
                        "location": {
                            "lat": child.get("stop_lat"),
                            "lon": child.get("stop_lon")
                        }
                    }
                    for child in child_stops
                ],
                "data_type": self.data_type,
                "updated_at": datetime.datetime.utcnow()
            }
            
            processed_stations.append(processed_station)
        
        # Insert processed stations
        if processed_stations:
            collection.insert_many(processed_stations)
            logger.info(f"Inserted {len(processed_stations)} processed stations")
    
    def _update_metadata(self):
        """Update metadata collection with processing information"""
        collection = self.db[COLLECTIONS["metadata"]]
        
        # Update or insert metadata
        collection.update_one(
            {"data_type": self.data_type},
            {
                "$set": {
                    "last_updated": datetime.datetime.utcnow(),
                    "source_url": self.gtfs_url,
                    "is_supplemented": self.is_supplemented
                }
            },
            upsert=True
        )
        
        logger.info(f"Updated metadata for {self.data_type} data")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Process MTA GTFS data and save to MongoDB")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--regular", action="store_true", help="Process regular GTFS data (default)")
    group.add_argument("--supplemented", action="store_true", help="Process supplemented GTFS data")
    
    args = parser.parse_args()
    
    # Default to regular if neither is specified
    is_supplemented = args.supplemented
    
    # Get MongoDB URI from environment or use default
    db_uri = MONGODB_URI
    
    # Create processor and process data
    processor = GTFSProcessor(db_uri, is_supplemented)
    processor.process_gtfs()


if __name__ == "__main__":
    main()