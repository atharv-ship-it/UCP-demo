// EV charging stations - stub (not relevant for Lennox AC, kept for compat)

export function searchChargingStations(locationQuery) {
  return {
    stations: [],
    count: 0,
    overview: {
      charging_specs: {
        ac_charging: 'AC Level 2',
        dc_charging: 'DC Fast Charge'
      }
    }
  }
}
