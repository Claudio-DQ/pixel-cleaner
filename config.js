/*
 * Pixel Cleaner — configurazione dei valori iniziali.
 *
 * Questo file viene caricato prima di app.js. Puoi modificare i valori qui
 * sotto per cambiare il comportamento predefinito dell'app; l'interfaccia
 * resta comunque utilizzabile e tutte le impostazioni possono essere
 * cambiate a mano.
 *
 * Nota: dopo una modifica, ricarica index.html (Ctrl+R) per applicarla.
 */
window.PIXEL_CLEANER_CONFIG = {
  defaults: {
    // Pulizia pixel isolati: 0 = nessuna, 1 = leggera, 2 = forte
    despeckle: 0,
    // Rende l'alpha completamente trasparente o opaco
    binaryAlpha: true,
    // Margine di campionamento dei bordi (0-40, in percentuale)
    margin: 25,
    // Hue shift iniziale (0-100). 0 = colori originali.
    hueShift: 0,
    // Mostra la griglia sopra l'anteprima originale
    showGrid: true,
    // Mostra l'overlay diagnostico (per ora solo contrasto adiacente)
    showDiagnostics: false,
    // Dimensione dei tile in pixel logici (0 = analisi tile disattivata)
    tileSize: 0,
    // Misura di uscita del ridimensionamento indicizzato (8-1024 px per lato)
    resizeWidth: 128,
    resizeHeight: 128,
    // 'area' (media dell'area, morbida) oppure 'nearest' (nitida)
    resizeMethod: 'area',
    // Margine trasparente attorno al contenuto, in pixel di uscita (0-16)
    resizeMargin: 2,
    // Copertura alpha minima per rendere opaco un pixel di uscita (5-95, %)
    resizeAlpha: 30,
  },

  // Preset rapidi mostrati nella riga "Riduci a" (1-64 colori).
  // Il tasto con il numero iniziale di colori viene aggiunto automaticamente.
  palettePresets: [4, 8, 12, 16, 24, 32, 48],

  // Numero massimo di colori della palette automatica.
  maxColors: 64,

  // Tolleranza OKLab usata per stimare i colori iniziali dell'immagine.
  autoMergeTolerance: 0.023,

  // Tolleranza OKLab per raggruppare i colori simili nella palette.
  // Modificando un colore vengono sostituiti anche i colori dello stesso gruppo.
  colorGroupTolerance: 0.035,
};
