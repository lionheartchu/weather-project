
const API_KEY = "bcd80b21e5b74547aa4170545250311";

async function fetchRealtimeWeather(q) {
  const url = `https://api.weatherapi.com/v1/current.json?key=${API_KEY}&q=${encodeURIComponent(q)}&aqi=yes`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // 打印完整 JSON
  console.log("🌤️ Full realtime weather data:", data);

  console.log("Current temperature (°C):", data.current.temp_c);
  console.log("Feels like (°C):", data.current.feelslike_c);
  console.log("Location:", data.location.name, data.location.country);

  return data;
}

async function getRealtimeWeather() {
  let data;
  if ('geolocation' in navigator) {
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject)
      );
      const lat = pos.coords.latitude.toFixed(6);
      const lon = pos.coords.longitude.toFixed(6);
      data = await fetchRealtimeWeather(`${lat},${lon}`);
    } catch {
      data = await fetchRealtimeWeather("auto:ip");
    }
  } else {
    data = await fetchRealtimeWeather("auto:ip");
  }

  document.getElementById("city").textContent =
    `${data.location.name}, ${data.location.country}`;

  document.getElementById("temp").textContent =
    `Temperature: ${data.current.temp_c}°C (Feels like ${data.current.feelslike_c}°C)`;
    
    document.getElementById("wind-v").textContent =
    `Wind speed: ${data.current.wind_kph}km/h`;

    document.getElementById("humidity").textContent =
    `Temperature: ${data.current.humidity}%`;

  document.getElementById("desc").textContent =
    `Condition: ${data.current.condition.text}`;
}

getRealtimeWeather();


