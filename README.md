# WizMax 360 Hotspot Studio v3 - Fixed

Zaawansowane narzędzie do automatycznego wykrywania i edycji hotspotów w obrazach 360° z naprawionymi algorytmami.

## 🚀 Funkcje

- **Automatyczne wykrywanie hotspotów** - inteligentny algorytm z tolerancją kolorów
- **Magic Wand Tool** - ręczne dodawanie/usuwanie regionów z tolerancją
- **Narzędzia edycji** - pióro, gumka, edycja węzłów poligonów
- **Marching Squares** - precyzyjne wykrywanie konturów
- **8-connected Flood Fill** - lepsze wykrywanie połączonych regionów
- **WebWorkers** - przetwarzanie w tle dla lepszej wydajności
- **Fallback Mode** - działanie bez WebWorkerów
- **Kwantyzacja kolorów** - opcjonalne zaokrąglanie dla lepszej detekcji

## 🛠️ Technologie

- React 18 + TypeScript
- Vite (build tool)
- Canvas API dla przetwarzania obrazów
- WebWorkers dla wydajności
- SVG dla renderowania hotspotów

## 📦 Instalacja

```bash
npm install
npm run dev
```

## 🎯 Użycie

1. **Załaduj obraz** - przeciągnij plik PNG/JPG
2. **Auto-przelicz** - automatyczne wykrywanie wszystkich regionów
3. **Magic Wand** - kliknij aby dodać/usunąć regiony ręcznie
4. **Edycja** - użyj narzędzi do precyzyjnej edycji poligonów
5. **Eksport** - pobierz wyniki jako JSON/SVG

## ⚙️ Parametry

- **Tolerancja** - margines kolorów dla Magic Wand (6-12)
- **Min. pole** - minimalny rozmiar regionu (1200-2000 px²)
- **Epsilon** - uproszczenie poligonów (0.8-1.5)
- **Min. krawędź** - minimalna długość krawędzi (2-4 px)
- **Min. kąt** - minimalny kąt dla zachowania węzłów (10-15°)

## 🔧 Skrypty

```bash
npm run dev              # Uruchomienie w trybie deweloperskim
npm run build            # Budowanie produkcyjne
npm run preview          # Podgląd buildu
npm run release:patch    # Nowa wersja patch (1.1.19 → 1.1.20)
npm run release:minor    # Nowa wersja minor (1.1.19 → 1.2.0)
npm run release:major    # Nowa wersja major (1.1.19 → 2.0.0)
```

## 🐛 Naprawione problemy

- ✅ **Inteligentna tolerancja** - auto-przeliczanie używa tolerancji 0 dla dokładnych kolorów
- ✅ **Zabezpieczenia** - ochrona przed nieskończonymi pętlami
- ✅ **Fallback** - działanie bez WebWorkerów
- ✅ **Kwantyzacja** - opcjonalne zaokrąglanie kolorów dla lepszej detekcji
- ✅ **Marching Squares** - precyzyjne wykrywanie konturów
- ✅ **8-connected Flood Fill** - lepsze wykrywanie połączonych regionów
- ✅ **Variable shadowing fix** - naprawiono błąd zacieniania zmiennych w processAll()
- ✅ **WebWorker fallback** - awaryjne przetwarzanie na głównym wątku

## 📝 Historia wersji

- **v1.1.20** - Naprawiona wersja z zaawansowanymi algorytmami
- **v1.1.19** - Ostatnia stabilna wersja (oryginalna)

## 🤝 Wkład

Projekt jest w aktywnej fazie rozwoju. Wszelkie sugestie i pull requesty są mile widziane!

## 📄 Licencja

MIT License - zobacz plik LICENSE dla szczegółów.
