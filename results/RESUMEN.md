# Estudio de 4 años: bot de futuros

Generado 2026-11-13 00:14 UTC · AAA, BBB, CCC · velas de 5m (espejo público de Binance) · 2024-03-01 → 2024-07-18.
Capital inicial 100 USDT. Comisiones de Bybit (taker 0,055 %, maker 0,02 %), slippage 0,03 % en entradas a mercado y stops, financiamiento estimado 0,01 % cada 8 h.
Órdenes límite: solo se llenan si el precio ATRAVIESA la orden (no alcanza con tocarla).

**Referencia, comprar y mantener la canasta 1x:** 2008.7 % · caída máxima 27.2 %.

## 1. ¿La idea gana algo? (parámetros fijos, todo el período, sin interruptor)
"Resultado medio (R)" positivo = la estrategia tiene ventaja después de costos.

|  | Variante | Ops | Acierto | Resultado medio (R) | Profit factor |
|---|---|---|---|---|---|
| A | Ruptura · entrada a mercado · 5 % fijo (lo que corre hoy) | 378 | 79.4 % | 1.202 | 1.96 |
| B | Ruptura · orden límite · 5 % fijo | 376 | 78.2 % | 1.250 | 2.01 |
| C | Ruptura · orden límite · tamaño según puntaje (2/4/6 %) | 373 | 78.6 % | 1.264 | 2.21 |
| D | Video (SMC) · orden límite · 5 % fijo | 54 | 29.6 % | -0.052 | 0.88 |
| E | Video (SMC) · orden límite · tamaño según puntaje (2/4/6 %) | 38 | 36.8 % | 0.206 | 1.23 |

## 2. La prueba que cuenta: walk-forward (meses que no vio, con interruptor del 40 %)

|  | Variante | Capital final | Retorno | Mensual | Caída máx. | Sharpe | Ops | Acierto | R medio | Interruptor |
|---|---|---|---|---|---|---|---|---|---|---|
| A | Ruptura · entrada a mercado · 5 % fijo (lo que corre hoy) | 84448.51 | 84348.5 % | 6649.2 % | 33.0 % | 30.08 | 135 | 77.0 % | 1.12 | no |
| B | Ruptura · orden límite · 5 % fijo | 62540.53 | 62440.5 % | 5494.1 % | 31.9 % | 28.43 | 143 | 74.1 % | 1.02 | no |
| C | Ruptura · orden límite · tamaño según puntaje (2/4/6 %) | 85301.54 | 85201.5 % | 6691.7 % | 28.5 % | 28.94 | 148 | 73.0 % | 0.98 | no |
| D | Video (SMC) · orden límite · 5 % fijo | 97.59 | -2.4 % | -1.5 % | 11.8 % | -0.49 | 3 | 33.3 % | -0.13 | no |
| E | Video (SMC) · orden límite · tamaño según puntaje (2/4/6 %) | 105.52 | 5.5 % | 3.4 % | 20.2 % | 1.06 | 17 | 35.3 % | 0.26 | no |

## 3. ¿El puntaje de tendencia sirve? (operaciones del backtest, por puntaje)
Si el acierto y el R medio suben con el puntaje, tiene sentido arriesgar más cuando el puntaje es alto.

**C. Ruptura · orden límite · tamaño según puntaje (2/4/6 %)**

| Puntaje | Ops | Acierto | R medio |
|---|---|---|---|
| < 0,34 | 0 | — | — |
| 0,34-0,5 | 0 | — | — |
| 0,5-0,84 | 226 | 77.4 % | 1.21 |
| ≥ 0,84 | 147 | 80.3 % | 1.35 |

**E. Video (SMC) · orden límite · tamaño según puntaje (2/4/6 %)**

| Puntaje | Ops | Acierto | R medio |
|---|---|---|---|
| < 0,34 | 0 | — | — |
| 0,34-0,5 | 8 | 37.5 % | 0.11 |
| 0,5-0,84 | 12 | 41.7 % | 0.37 |
| ≥ 0,84 | 18 | 33.3 % | 0.14 |

## 4. Cuánto arriesgar por operación (mejor variante: A)

| Riesgo por operación | Capital final | Retorno | Mensual | Caída máx. | Interruptor |
|---|---|---|---|---|---|
| 1.0 % | 438.53 | 338.5 % | 151.9 % | 7.6 % | no |
| 2.0 % | 1789.64 | 1689.6 % | 506.8 % | 14.7 % | no |
| 3.0 % | 6846.28 | 6746.3 % | 1303.6 % | 21.2 % | no |
| 5.0 % | 84448.51 | 84348.5 % | 6649.2 % | 33.0 % | no |

## 5. Detalle por par (walk-forward, mejor variante A)

| Par | Ops | Acierto | USDT |
|---|---|---|---|
| CCC | 61 | 77 % | 37596.55 |
| AAA | 45 | 78 % | 27148.55 |
| BBB | 29 | 76 % | 19029.62 |

Tiempo total: 0 min.
