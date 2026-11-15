# Pixel Cleaner

Strumento locale per pulire pixel art generata dall'AI: rileva la griglia di
upscaling, ricostruisce i pixel logici e riduce le tonalità indesiderate,
mostrando il risultato in anteprima e una diagnosi del contrasto tra colori
adiacenti. Le coppie troppo simili possono essere separate su richiesta con una
correzione automatica verificata e annullabile.

Funziona interamente nel browser, senza installazione, senza server e senza
dipendenze esterne a runtime. Basta aprire `index.html`. L'interfaccia usa un
tema retro/pixel minimal con il font **Silkscreen** incluso localmente, quindi
non serve alcuna connessione a Internet.

## Avvio

1. Scarica o copia la cartella del progetto.
2. Apri `index.html` con un doppio clic (funziona anche da `file://`).
3. Trascina un'immagine, premi **Apri immagine** oppure incolla con `Ctrl+V`.

L'elaborazione avviene in locale: nessuna immagine viene caricata su Internet.

## Uso rapido

1. Apri un'immagine AI (PNG, JPG, WebP o GIF: viene usato il primo fotogramma).
2. Controlla la griglia rilevata: scala e offset devono combaciare con i bordi
   dei pixel. Se compaiono due o più **Proposte**, scegli quella giusta; i
   controlli manuali e **Auto** restano nascosti. Altrimenti correggi scala e
   offset a mano o premi **Auto**.
3. Scegli quanti colori usare con i pulsanti **Riduci a**: il primo mostra il
   conteggio automatico dell'immagine (fino a 64), gli altri i preset inferiori.
4. Per cambiare colori specifici, clicca uno swatch e premi **Sostituisci**: il
   nuovo colore viene applicato anche ai colori simili, evidenziati nella
   palette. Con **Armonia HSL** puoi applicare un hue shift globale.
5. Se restano pixel isolati, prova **Pixel isolati → Leggera** o **Forte**.
6. Se ti serve una misura precisa, apri **Dimensione**, imposta larghezza e
   altezza, scegli **Area** o **Nearest** e premi **Ridimensiona**. Il
   contenuto viene centrato con un piccolo margine trasparente.
7. Controlla la scheda **Diagnosi**: mostra il contrasto tra colori adiacenti e
   segnala le coppie troppo simili. Attiva **Evidenzia il contrasto** per
   vedere i bordi coinvolti nell'anteprima.
8. Se il contrasto non ti convince, premi **Risolvi** sulla riga Contrasto.
   La correzione è sempre facoltativa, verificata dal motore e annullabile con
   **Annulla ultima correzione**.
9. Esporta il PNG alla scala desiderata con **Esporta** o `Ctrl+S`.

## Controlli

### Griglia

- **Scala**: dimensione in pixel dell'immagine di partenza rispetto a quella
  caricata (es. `16` significa che ogni pixel logico occupa 16×16 pixel). Il
  campo è visibile solo quando non ci sono almeno due proposte.
- **Offset X / Y**: spostamento della griglia rispetto all'angolo in alto a
  sinistra. È visibile solo quando la scala non è stata trovata automaticamente
  o scelta da una proposta; se imposti una scala manuale maggiore di 1 puoi
  correggerlo.
- **Auto**: riesegue il rilevamento automatico. Resta visibile insieme alla
  scala manuale solo quando le proposte non bastano.
- **Proposte**: mostra le scale che hanno un riscontro reale nella griglia
  (celle uniformi, bordi allineati e supporto sufficiente). Quando ce ne sono
  almeno due, la scala manuale e **Auto** vengono nascosti e un clic sul chip
  applica la scala; la proposta attiva è evidenziata.
- **Griglia** (nell'anteprima originale): mostra o nasconde i confini della
  griglia rilevata.

La scala massima è 256. L'offset viene sempre normalizzato tra `0` e
`scala - 1`.

### Colori

- **Conteggio iniziale**: una passata automatica stima i colori dell'immagine
  con quantizzazione pesata in OKLab e fusione dei cluster vicini, fino a un
  massimo di 64. Il numero risultante diventa il pulsante più alto della riga
  **Riduci a**.
- **Riduci a**: i pulsanti sono dinamici. Il primo usa il conteggio automatico;
  gli altri mostrano i preset inferiori configurati in `config.js` (4, 8, 12,
  16, 24, 32, 48). Ogni clic quantizza la palette al numero esatto di colori
  indicato.
- **Ripristina** in fondo alla palette riporta ai colori generati
  automaticamente. La palette mostra sempre i colori effettivamente usati,
  ordinati per tinta (prima i neutri) senza modificare gli indici interni.

#### Armonia HSL e hue shift

- Selezionando un colore, accanto al codice esadecimale compaiono i valori
  **H** (tonalità), **S** (saturazione) e **L** (luminosità).
- Il pannello **Armonia HSL** è sempre visibile. **Hue shift** applica una
  variazione globale: le ombre vengono spostate verso il blu-viola e le luci
  verso il giallo caldo. Il valore 0% lascia i colori originali.
- Il cursore aggiorna l'anteprima in tempo reale. **Ripristina** riporta la
  palette originale e azzera anche il hue shift.
- Il hue shift resta attivo cambiando despeckle, alpha o numero di colori;
  viene riportato al valore di `config.js` quando si carica una nuova immagine.

#### Personalizzare i singoli colori

- **Colori simili**: la palette raggruppa i colori con distanza OKLab inferiore
  a `colorGroupTolerance` (0,035 per impostazione predefinita). Selezionando uno
  swatch, gli altri membri del gruppo vengono evidenziati.
- **Sostituisci**: dopo aver selezionato un colore, scegli il nuovo colore dal
  selettore del browser. Il nuovo colore viene applicato allo swatch e a tutti
  i colori simili del gruppo.
- **Ripristina**: riporta la palette a quella generata automaticamente.
- Le sostituzioni restano fisse anche se poi cambi il hue shift; gli altri
  colori continuano a seguire l'armonia HSL.
- Le sostituzioni restano applicate anche cambiando despeckle o alpha; vengono
  azzerate quando la palette viene rigenerata (ad esempio cambiando il numero
  di colori, la griglia, il margine o l'immagine). Il hue shift è gestito
  separatamente come descritto sopra.
- Premi `Esc` per deselezionare il colore attivo.

### Pulizia

- **Pixel isolati**:
  - *Nessuna*: conserva ogni dettaglio (impostazione predefinita).
  - *Leggera*: rimuove i singoli pixel circondati da un colore diverso.
  - *Forte*: rimuove anche coppie isolate di pixel.
- **Alpha binario**: rende completamente trasparenti i pixel semitrasparenti.
  Utile per sprite con bordi sfumati; disattivalo se vuoi conservare l'alpha
  originale.
- **Margine di campionamento** (Impostazioni avanzate): percentuale di bordo
  di ogni cella ignorata durante la lettura del colore. Il valore predefinito
  è 25%. Aumentalo se l'immagine è molto sfocata o compressa.

### Dimensione

La scheda **Dimensione** ridimensiona l'immagine logica ricostruita dalla
griglia, mantenendo palette e trasparenza. Non ricampiona l'originale: lavora
sugli indici dei pixel, quindi il risultato resta pixel art con gli stessi
colori.

- **Larghezza / Altezza**: misura di uscita in pixel logici, da 8 a 1024 per
  lato. I valori iniziali sono 128×128.
- **Metodo**:
  - *Area* (predefinito): media pesata dei pixel opachi coperti da ogni pixel
    di uscita, poi mappatura al colore più vicino della palette in OKLab. È il
    metodo consigliato quando il fattore di riduzione non è intero, perché
    conserva meglio volumi e dettagli.
  - *Nearest*: campiona il centro della cella e mantiene esattamente i colori
    esistenti. Utile per riduzioni intere o quando serve un bordo più netto.
- **Margine**: spazio trasparente attorno al contenuto, in pixel di uscita
  (0–16, predefinito 2). Il contenuto visibile viene centrato sul bounding box
  dell'alpha.
- **Soglia alpha** (Impostazioni avanzate): copertura minima perché un pixel
  diventi opaco (5–95%, predefinito 30%). Alzala per bordi più netti,
  abbassala per conservare dettagli sottili come la punta della spada.
- **Ridimensiona** applica la nuova misura; **Torna all'originale** ripristina
  la misura logica ricostruita.
- Dopo il ridimensionamento, anteprima, diagnosi, correzioni, palette ed export
  lavorano alla nuova misura. Il badge mostra sempre la misura corrente.
- La misura scelta resta attiva quando cambi despeckle, colori o griglia: la
  pipeline viene rieseguita e il ridimensionamento viene ricalcolato. Le
  correzioni automatiche fatte alla misura ridotta vengono azzerate in quel
  caso. Le modifiche alla palette (sostituzioni e hue shift) restano invece
  applicate senza perdere la misura.

### Diagnosi

La scheda **Diagnosi** analizza la griglia di pixel logici ricostruita, dopo
l'eventuale despeckle. In questa versione mostra soltanto il **contrasto
adiacente**: il riquadro riporta la percentuale di confini tra colori diversi
con distanza OKLab sufficiente, insieme al numero di colori usati, alle tinte
(fasce di 30° con saturazione almeno 10%), ai toni (fasce di luminosità del
10%) e all'intervallo di luminosità HSL.

- **Contrasto**: coppie di colori confinanti con distanza percettiva OKLab
  inferiore a 0,06. La legenda riporta quante coppie sono coinvolte; l'overlay
  rosso mostra i pixel al confine. Le coppie della palette con distanza
  inferiore a 0,035 sono considerate **colori simili** e non hanno un overlay
  dedicato.
- Il badge principale somma solo le coppie a basso contrasto. I conteggi
  restano visibili anche con l'overlay spento; la casella **Evidenzia il
  contrasto** mostra soltanto la sovrapposizione colorata sul risultato.

La diagnosi non modifica l'immagine: la correzione parte solo quando premi
**Risolvi** sulla riga Contrasto. L'overlay resta esclusivamente nell'anteprima
e non entra mai nel PNG esportato o copiato.

Le analisi di linee, pixel isolati e bordi tile restano nel motore e nella
diagnosi interna, ma in questa versione non sono mostrate nell'interfaccia né
hanno pulsanti **Risolvi** visibili.

#### Correzioni automatiche

La correzione del contrasto è sempre su richiesta, non viene mai applicata
all'apertura dell'immagine e può essere annullata. Sotto la legenda compaiono
**Annulla ultima correzione** e il numero di correzioni ancora annullabili.

- **Contrasto**: sposta soltanto la luminosità HSL delle coppie troppo simili,
  mantenendo tinta e saturazione, poi verifica il risultato con
  `analyzePalette`. Preferisce lo spostamento più piccolo che elimina le coppie
  deboli. La modifica entra nella palette personalizzata e può essere riportata
  indietro con **Ripristina** nella sezione Colori.

Se nessun candidato migliora la diagnosi, l'immagine resta invariata e un
messaggio spiega che non esiste una correzione automatica sicura. Le correzioni
non sono mai silenziose: il risultato, la palette, i conteggi e l'anteprima
vengono aggiornati subito. La cronologia conserva fino a 16 passi e viene
svuotata quando la pipeline rigenera il risultato o quando modifichi la palette
a mano; in quei casi il pulsante di annullamento si disattiva. Anche le
correzioni entrano nel PNG esportato o copiato, mentre gli overlay diagnostici
restano fuori.

Le analisi legacy di linee, isolati e tile continuano a essere calcolate quando
cambiano immagine, griglia, colori o despeckle, senza però essere esposte
nell'interfaccia corrente.

### Esportazione

- Il primo selettore accanto a **Esporta** sceglie la scala di uscita (1×, 2×,
  4×, 8×, 16×, 32×, in base ai limiti dell'immagine).
- Il secondo selettore (**100% / 75% / 50% / 25%**) riduce l'uscita scelta
  mantenendo le proporzioni: l'anteprima si restringe della stessa percentuale
  e il PNG esportato (o copiato) usa la nuova dimensione. Il ridimensionamento
  è nearest-neighbor, quindi non introduce colori intermedi.
- **Esporta** scarica un PNG con nome `<originale>-pulita.png`. Se hai usato
  **Dimensione**, il nome include la misura effettiva del file, ad esempio
  `<originale>-128x128-pulita.png` (o `-256x256-` se esporti a 2×).
- L'icona degli appunti copia il PNG negli appunti. La funzione dipende dal
  browser e dai permessi: se non funziona, usa l'esportazione PNG.

### Scorciatoie da tastiera

| Comando | Azione |
| --- | --- |
| `Ctrl+O` / `Cmd+O` | Apre la scelta del file |
| `Ctrl+V` / `Cmd+V` | Incolla un'immagine dagli appunti |
| `Ctrl+S` / `Cmd+S` | Esporta il PNG (se c'è un risultato) |
| `Esc` | Chiude l'area di trascinamento o deseleziona il colore attivo |

## Configurazione iniziale

I valori di partenza si trovano in `config.js`, caricato prima di `app.js`.
Dopo una modifica ricarica la pagina con `Ctrl+R`.

| Campo | Valori | Descrizione |
| --- | --- | --- |
| `despeckle` | 0, 1, 2 | Pulizia pixel isolati iniziale |
| `binaryAlpha` | booleano | Alpha binario iniziale |
| `margin` | 0–40 | Margine di campionamento iniziale, in percentuale |
| `hueShift` | 0–100 | Hue shift iniziale; 0 = colori originali |
| `showGrid` | booleano | Griglia visibile nell'anteprima originale |
| `showDiagnostics` | booleano | Overlay del contrasto adiacente visibile all'avvio |
| `tileSize` | 0–256 | Dimensione iniziale delle tile per la diagnosi interna; 0 = analisi disattivata |
| `resizeWidth` | 8–1024 | Larghezza iniziale del ridimensionamento, in pixel logici |
| `resizeHeight` | 8–1024 | Altezza iniziale del ridimensionamento, in pixel logici |
| `resizeMethod` | `area`, `nearest` | Metodo di ridimensionamento iniziale |
| `resizeMargin` | 0–16 | Margine trasparente iniziale attorno al contenuto, in pixel di uscita |
| `resizeAlpha` | 5–95 | Copertura alpha minima iniziale, in percentuale |
| `palettePresets` | array di numeri | Preset della riga **Riduci a**; vengono mostrati solo quelli inferiori al conteggio iniziale (default `[4, 8, 12, 16, 24, 32, 48]`) |
| `maxColors` | 1–64 | Numero massimo di colori della palette automatica (default 64) |
| `autoMergeTolerance` | 0–0.2 OKLab | Tolleranza di fusione dei cluster nella passata automatica (default `0.023`) |
| `colorGroupTolerance` | 0–0.3 OKLab | Tolleranza per raggruppare i colori simili nella palette (default `0.035`) |

Esempio:

```js
window.PIXEL_CLEANER_CONFIG = {
  defaults: {
    despeckle: 1,
    hueShift: 0,
    // ...
  },
  palettePresets: [4, 8, 12, 16, 24, 32, 48],
  maxColors: 64,
  autoMergeTolerance: 0.023,
  colorGroupTolerance: 0.035,
};
```

I valori non validi vengono corretti o ignorati; se `palettePresets` è vuoto
viene usato l'elenco predefinito. La configurazione non impedisce di cambiare
tutto dall'interfaccia: imposta solo i valori di partenza.

## Demo

Il pulsante **Prova demo** carica un'immagine di esempio incorporata nel file
`demo.js`, così funziona anche senza rete e senza problemi di sicurezza del
canvas. In alternativa apri:

```text
index.html?demo=1
```

La demo è un'immagine 768×768 con griglia 16× (48×48 pixel logici). Con le
impostazioni predefinite viene ricostruita con 30 colori.

## Come funziona

1. **Rilevamento della griglia**: le differenze di colore tra pixel adiacenti
   formano profili orizzontali e verticali. Il motore misura le scale candidate
   e le accetta solo se le celle sono quasi uniformi al loro interno, se i
   cambi di colore forti cadono sui bordi delle celle e se ci sono abbastanza
   bordi allineati in tutta l'immagine. La variabilità residua al centro della
   cella deve essere minore di quella sull'anello esterno: così una sfocatura o
   una sfumatura non bastano a inventare una griglia. Le scale piccole (2×–3×)
   richiedono una periodicità esplicita nei profili, perché lì non esiste un
   centro di cella sufficientemente ampio per giudicare la purezza. Se nessuna
   scala supera tutte le verifiche, il risultato resta 1×; le alternative
   plausibili vengono elencate in **Proposte**.
2. **Campionamento**: per ogni cella viene preso il centro (escludendo il
   margine), poi si usa la mediana per canale. Questo elimina bordi sfocati,
   rumore JPEG e aloni dell'upscaling AI.
3. **Quantizzazione**: i colori delle celle vengono raggruppati in bin a 5 bit
   e convertiti in OKLab, uno spazio percettivamente più uniforme di RGB. Una
   prima passata automatica usa k-means pesato, fonde i cluster vicini e stima
   il conteggio iniziale (fino a `maxColors`); i pulsanti **Riduci a** rieseguono
   k-means con il numero esatto di colori scelto.
4. **Pulizia**: il despeckle lavora sugli indici della palette, quindi non
   introduce nuovi colori. La palette finale viene compattata e ordinata per
   frequenza d'uso.
5. **Diagnosi**: per ogni colore della palette vengono misurate le sequenze
   orizzontali e verticali di pixel. Le doppie sono giunzioni a "Z" in cui due
   segmenti paralleli si sovrappongono di un pixel; scalini e rotture sono
   interruzioni del ritmo dei segmenti su tratti sottili. Le sequenze vengono
   poi concatenate per classificare pendenze perfette, ritmi intermedi, curve
   progressive e tratti irregolari. In parallelo la palette viene riassunta in
   HSL e confrontata in OKLab: i confini tra colori diversi misurano il
   contrasto percepito e le coppie quasi identiche segnalano colori ridondanti.
   Le componenti connesse di 1–4 px circondate da un colore dominante vengono
   elencate come pixel isolati. Se è attiva una dimensione tile, la griglia
   viene anche divisa in tile quadrate per contare uniche, duplicate e vuote e
   per confrontare la continuità dei bordi interni con quella interna alle tile.
   L'analisi produce solo maschere e overlay di anteprima, senza modificare gli
   indici o la palette. L'interfaccia corrente espone soltanto il contrasto
   adiacente; le altre analisi restano disponibili nel motore.
6. **Correzioni automatiche**: il pulsante **Risolvi** della riga Contrasto
   esegue una ricerca locale e verificata sulla luminosità HSL della palette.
   Le correzioni legacy di linee, isolati e tile restano nel motore ma non sono
   raggiungibili dall'interfaccia. L'input originale non viene mai modificato: il
   motore restituisce una copia degli indici o della palette, e l'app registra
   uno snapshot per l'annullamento.
7. **Ridimensionamento**: il metodo Area calcola per ogni pixel di uscita la
   media dei colori di origine pesata sull'area effettivamente coperta e sulla
   loro opacità, poi sceglie la voce di palette più vicina in OKLab. Il metodo
   Nearest legge invece il centro della cella. Il contenuto viene adattato al
   bounding box dell'alpha (o all'intero canvas con `fit: 'canvas'`), centrato e
   arrotondato a pixel interi; l'alpha di uscita è binario e usa la soglia di
   copertura scelta.
8. **Esportazione**: l'immagine logica viene ricomposta e ingrandita con
   nearest-neighbor, mantenendo i bordi netti. Le personalizzazioni HSL vengono
   applicate alla palette prima della ricomposizione.

## Formati e limiti

- Formati: PNG, JPG, WebP, GIF (primo fotogramma).
- Dimensione massima: 8192 px per lato e 40 megapixel.
- L'analisi è sincrona: un'immagine molto grande (4K–8K) può richiedere
  qualche secondo prima di mostrare il risultato.
- La rilevazione automatica è volutamente prudente. Con immagini molto
  sfocate a scale piccole (2×–3×), o con forti artefatti JPEG a blocchi di
  8 px, può ripiegare su 1× invece della scala reale: in questi casi imposta
  la scala a mano o scegli una delle **Proposte**.
- La palette automatica arriva fino a 64 colori. I pulsanti **Riduci a**
  applicano il conteggio esatto scelto; se una riduzione fonde dettagli rari
  (stelle, riflessi, particelle), scegli un conteggio più alto.
- Il despeckle è disattivato per impostazione predefinita proprio per non
  cancellare dettagli intenzionali.
- Il ridimensionamento accetta da 8 a 1024 px per lato. Il motore rifiuta
  comunque output oltre 4096 px per lato o 4.194.304 pixel complessivi; in quel
  caso l'app mostra un messaggio e lascia attiva la misura precedente.
- La diagnosi di contrasto usa soglie advisory: 0,06 di distanza OKLab per i
  bordi e 0,035 per i colori simili. Le sfumature ravvicinate possono essere
  intenzionali; non vengono corrette all'apertura, ma solo se premi **Risolvi**
  sulla riga Contrasto. La correzione sposta la luminosità di pochi punti e
  potrebbe cambiare leggermente l'equilibrio cromatico: controlla l'anteprima e,
  se serve, annulla o ripristina la palette.
- Le analisi legacy dei pixel isolati (componenti compatte fino a 4 px) e dei
  bordi tile restano nel motore, ma non sono mostrate nell'interfaccia corrente:
  non entrano nel badge e non hanno un pulsante **Risolvi** visibile.
- Le correzioni automatiche sono volutamente prudenti e con budget limitato:
  non provano a ridisegnare il disegno, non aggiungono voci alla palette e si
  fermano se non trovano un miglioramento verificato. Una correzione può
  richiedere qualche istante su griglie grandi; in quel caso l'interfaccia
  mostra lo stato occupato.
- La diagnosi e le correzioni vengono eseguite fino a 262.144 pixel logici (ad
  esempio 512×512). Oltre questo limite anteprima ed esportazione restano
  disponibili, ma la scheda **Diagnosi** avvisa che l'analisi è stata saltata e
  i pulsanti **Risolvi** non modificano l'immagine.

## Struttura del progetto

```text
index.html            pagina dell'app
src/app.css           sorgente Tailwind del tema retro/pixel
styles.css            CSS compilato e minificato (generato, non modificare)
fonts/                font Silkscreen (400/700) e licenza OFL
config.js             valori iniziali e preset configurabili
app.js                stato, anteprime, controlli ed esportazione
engine.js             motore puro (rilevamento, campionamento, colori, pulizia, ridimensionamento, diagnosi, correzioni)
demo.js               immagine demo incorporata come data URL
samples/              immagine demo e riferimento pulito
test/engine.test.js   suite di test del motore (78 test)
tools/detect-matrix.js diagnostica della griglia su casi sintetici
tools/make-demo.py    generatore della demo (solo sviluppo)
package.json          script di compilazione dell'interfaccia (solo sviluppo)
```

## Sviluppo dell'interfaccia

L'app non ha dipendenze a runtime: `index.html` carica direttamente il file
`styles.css` già compilato. Il tema è scritto con **Tailwind CSS 4** in
`src/app.css`; Node.js e le dipendenze di sviluppo servono solo per rigenerare
il CSS dopo una modifica.

```bash
npm install
npm run build:css     # ricompila styles.css, minificato
npm run watch:css     # ricompila a ogni modifica
```

Se modifichi `index.html`, `app.js` o `src/app.css`, esegui `npm run build:css`
prima di aprire la pagina. Non modificare `styles.css` a mano: viene
sovrascritto dalla compilazione. I font in `fonts/` sono distribuiti con
licenza SIL Open Font License (vedi `fonts/OFL.txt`).

## Test

Serve Node.js (nessuna dipendenza da installare per i test del motore):

```bash
node test/engine.test.js
```

La suite copre rilevamento della griglia (scale, offset, blur, rumore,
immagini lisce, immagini native 74×74 con dettaglio fine, ricampionamento non
intero e proposte di scala circoscritte ai divisori verificati), campionamento,
quantizzazione manuale e automatica, alpha,
despeckle, conversioni HSL, compattazione della palette, raggruppamento dei
colori simili, ridimensionamento
nearest-neighbor con colori invariati, ridimensionamento indicizzato (bounding
box con margine, media d'area mappata in OKLab, griglia 1:1, soglia alpha,
adattamento dell'intero canvas, ingrandimento a blocchi, input vuoti e limiti),
pipeline completa,
diagnosi pixel art (doppie, scalini, rotture, pendenze perfette, ritmi
alternati, curve progressive, tratti irregolari, bande spesse e limite di
griglia), diagnosi della palette (fasce HSL di tinta e luminosità, colori
quasi identici, contrasto adiacente OKLab, colori separati per tinta,
trasparenza e griglie oltre il limite), pixel isolati (singoli, gruppi compatti,
diagonali e tratti sottili esclusi, trasparenza, bordi immagine, intorni
bilanciati e limite di griglia) e tile (layout, tile uniche, duplicate e vuote,
continuità dei bordi, avanzo ignorato, dimensioni non valide e limite di
griglia). Copre inoltre le correzioni automatiche: riparazione di doppie,
scalini, rotture e tratti irregolari con verifica della griglia originale,
rispetto dei limiti e dei budget, rimozione degli isolati in più passaggi
(anche parziale e ripetibile), aumento del contrasto con tinta e saturazione
preservate e armonizzazione dei bordi tile accettata solo se i bordi sospetti
diminuiscono.

Diagnostica opzionale della griglia su una matrice di casi sintetici:

```bash
node tools/detect-matrix.js
```

Stampa il numero di casi riconosciuti e i dettagli dei fallimenti. È uno
strumento di messa a punto, non un test bloccante: i casi con blur molto forte
o artefatti JPEG simulati sono deliberatamente difficili.

Per rigenerare l'immagine demo serve Python con Pillow; il comando è:

```bash
python tools/make-demo.py
```

## Privacy

Tutto gira nel browser. Non ci sono richieste di rete, analytics, cookie o
servizi esterni. L'unico accesso agli appunti avviene quando premi **Incolla**
o l'icona di copia.
