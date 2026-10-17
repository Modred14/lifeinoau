export const CAMPUS_BBOX = { west: 4.509, east: 4.5305, south: 7.4955, north: 7.5248 } as const;
export const GEO_PX_PER_M = 20;
export const M_PER_LON = 111320 * Math.cos(((CAMPUS_BBOX.north + CAMPUS_BBOX.south) / 2) * (Math.PI / 180));
export const M_PER_LAT = 110574;

export function latLngToMap(lat: number, lng: number): { x: number; y: number } {
  return {
    x: (lng - CAMPUS_BBOX.west) * M_PER_LON * GEO_PX_PER_M,
    y: (CAMPUS_BBOX.north - lat) * M_PER_LAT * GEO_PX_PER_M,
  };
}
