'use client';

import React, { useEffect, useState } from 'react';
import {
  Cloud,
  Sun,
  CloudRain,
  Wind,
  Droplets,
  MapPin,
  RefreshCw,
  Check,
  LocateFixed,
} from 'lucide-react';
import { SearchRegion, WeatherData } from '@/lib/search-types';
import { setStoredWeatherCity } from '@/lib/local-storage';

const REGION_DEFAULT_CITY: Record<Exclude<SearchRegion, 'auto'>, string> = {
  'pt-PT': 'Lisbon',
  'pt-BR': 'São Paulo',
  'es-ES': 'Madrid',
  'fr-FR': 'Paris',
  'de-DE': 'Berlin',
  'en-US': 'New York',
  'en-GB': 'London',
  global: 'London',
};

function resolveRegionDefaultCity(region: SearchRegion = 'auto'): string {
  if (region !== 'auto' && REGION_DEFAULT_CITY[region]) {
    return REGION_DEFAULT_CITY[region];
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith('pt-br')) return 'São Paulo';
    if (lang.startsWith('pt')) return 'Lisbon';
    if (lang.startsWith('es')) return 'Madrid';
    if (lang.startsWith('fr')) return 'Paris';
    if (lang.startsWith('de')) return 'Berlin';
    if (lang === 'en-us') return 'New York';
  }
  return 'London';
}

interface WeatherWidgetProps {
  region?: SearchRegion;
}

export function WeatherWidget({ region = 'auto' }: WeatherWidgetProps) {
  const [city, setCity] = useState('London');
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [inputCity, setInputCity] = useState('London');
  const [tempUnit, setTempUnit] = useState<'C' | 'F'>('C');
  const [geoStatus, setGeoStatus] = useState<string | null>(null);

  const fetchWeather = async (targetCity: string) => {
    setLoading(true);
    setGeoStatus(null);
    try {
      const res = await fetch(`/api/weather?city=${encodeURIComponent(targetCity)}`);
      if (res.ok) {
        const data: WeatherData = await res.json();
        setWeather(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const manualCity =
      typeof window !== 'undefined' ? localStorage.getItem('searx_weather_city')?.trim() : '';
    const targetCity = manualCity || resolveRegionDefaultCity(region);

    fetch(`/api/weather?city=${encodeURIComponent(targetCity)}`)
      .then((res) => res.json())
      .then((data: WeatherData) => {
        if (active) {
          setCity(targetCity);
          setInputCity(targetCity);
          setWeather(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setCity(targetCity);
          setInputCity(targetCity);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [region]);

  const handleUseLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoStatus('Geolocation unavailable');
      return;
    }
    setLoading(true);
    setGeoStatus(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `/api/weather?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`
          );
          if (res.ok) {
            const data: WeatherData = await res.json();
            setWeather(data);
            setCity(data.city);
            setInputCity(data.city);
            setStoredWeatherCity(data.city);
          }
        } catch {
          setGeoStatus('Weather lookup failed');
        } finally {
          setLoading(false);
        }
      },
      () => {
        setLoading(false);
        setGeoStatus('Location permission denied');
      },
      { timeout: 6000, maximumAge: 600_000 }
    );
  };

  const handleCitySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputCity.trim()) {
      const newCity = inputCity.trim();
      setCity(newCity);
      setStoredWeatherCity(newCity);
      setIsEditing(false);
      fetchWeather(newCity);
    }
  };

  const convertTemp = (celsius: number) => {
    if (tempUnit === 'F') return Math.round((celsius * 9) / 5 + 32);
    return Math.round(celsius);
  };

  const getWeatherIcon = (text: string) => {
    const t = text.toLowerCase();
    if (t.includes('rain') || t.includes('drizzle')) {
      return <CloudRain className="h-5 w-5 text-neutral-600 dark:text-neutral-400" />;
    }
    if (t.includes('clear') || t.includes('sunny')) {
      return <Sun className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />;
    }
    return <Cloud className="h-5 w-5 text-neutral-600 dark:text-neutral-400" />;
  };

  return (
    <div className="rounded-3xl pharol-liquid-glass p-5 transition-colors">
      <div className="flex items-center justify-between pb-3 border-b border-neutral-900/10 dark:border-white/10">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-900 dark:text-neutral-100 min-w-0">
          <MapPin className="h-3.5 w-3.5 text-neutral-500 shrink-0" />
          {isEditing ? (
            <form onSubmit={handleCitySubmit} className="flex items-center gap-1">
              <input
                type="text"
                value={inputCity}
                onChange={(e) => setInputCity(e.target.value)}
                placeholder="City name"
                className="w-28 rounded border border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                autoFocus
              />
              <button type="submit" aria-label="Save city" className="text-neutral-600 hover:text-neutral-950 dark:text-neutral-400">
                <Check className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="hover:underline flex items-center gap-1 truncate"
              title="Click to change local weather city"
            >
              <span className="truncate">{weather?.city || city}</span>
              {weather?.country && (
                <span className="text-[11px] font-normal text-neutral-400 shrink-0">· {weather.country}</span>
              )}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleUseLocation}
            className="text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
            aria-label="Use my location"
            title="Use current browser location"
          >
            <LocateFixed className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setTempUnit(tempUnit === 'C' ? 'F' : 'C')}
            className="text-[11px] font-mono text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
          >
            °{tempUnit}
          </button>
          <button
            type="button"
            onClick={() => fetchWeather(city)}
            className="text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
            aria-label="Refresh weather"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {geoStatus && (
        <div className="pt-2 text-[11px] text-amber-600 dark:text-amber-400">{geoStatus}</div>
      )}

      {loading && !weather ? (
        <div className="py-8 text-center text-xs text-neutral-400">Loading forecast...</div>
      ) : weather ? (
        <div className="pt-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getWeatherIcon(weather.weatherText)}
              <div>
                <div className="text-2xl font-bold tracking-tight text-neutral-950 dark:text-white tabular-nums">
                  {convertTemp(weather.temperature)}°{tempUnit}
                </div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                  {weather.weatherText}
                </div>
              </div>
            </div>

            <div className="text-right text-[11px] text-neutral-500 dark:text-neutral-400 space-y-1">
              <div className="flex items-center justify-end gap-1">
                <Wind className="h-3 w-3" />
                <span className="tabular-nums">{weather.windSpeed} km/h</span>
              </div>
              <div className="flex items-center justify-end gap-1">
                <Droplets className="h-3 w-3" />
                <span className="tabular-nums">{weather.humidity}% humidity</span>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-1 border-t border-neutral-900/10 pt-3 dark:border-white/10 text-center">
            {weather.daily.slice(1, 5).map((d, i) => (
              <div key={i} className="text-[11px]">
                <div className="text-neutral-400 font-mono text-[10px]">
                  {d.date.length > 5 ? d.date.slice(5) : d.date}
                </div>
                <div className="font-semibold text-neutral-800 dark:text-neutral-200 tabular-nums my-0.5">
                  {convertTemp(d.tempMax)}°
                </div>
                <div className="text-[10px] text-neutral-400 tabular-nums">
                  {convertTemp(d.tempMin)}°
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
