// -----------------------------------------------------------------------------
// Every text the integration produces, in the four languages of the Gladys
// interface (English, French, German, Spanish). German says "du", Spanish says
// "usted". The vocabulary follows the Gladys interface (front/src/config/i18n).
// Brands (Tractive, Gladys) are never translated. test/i18n.test.js checks
// that no language is missing and no text is empty or too long.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';

/** Feature names, frozen by Gladys when the user adds the device. */
export const NAMES = {
  en: {
    battery: 'Battery',
    charging: 'Charging',
    distance: 'Distance from home',
    accuracy: 'Position accuracy',
    at_home: 'At home',
    online: 'Tracker online',
    power_saving: 'Power saving',
    activity: 'Activity today',
    rest: 'Rest today',
    activity_goal: 'Daily activity goal',
    live_tracking: 'Live tracking',
    buzzer: 'Buzzer',
    led: 'Light (LED)',
  },
  fr: {
    battery: 'Batterie',
    charging: 'En charge',
    distance: 'Distance de la maison',
    accuracy: 'Précision de la position',
    at_home: 'À la maison',
    online: 'Traceur en ligne',
    power_saving: "Économie d'énergie",
    activity: "Activité aujourd'hui",
    rest: "Repos aujourd'hui",
    activity_goal: "Objectif d'activité",
    live_tracking: 'Suivi en direct',
    buzzer: 'Buzzer',
    led: 'Lumière (LED)',
  },
  de: {
    battery: 'Batterie',
    charging: 'Lädt',
    distance: 'Abstand zum Zuhause',
    accuracy: 'Genauigkeit der Position',
    at_home: 'Zu Hause',
    online: 'Tracker online',
    power_saving: 'Energiesparmodus',
    activity: 'Aktivität heute',
    rest: 'Ruhe heute',
    activity_goal: 'Tägliches Aktivitätsziel',
    live_tracking: 'Live-Tracking',
    buzzer: 'Summer',
    led: 'Licht (LED)',
  },
  es: {
    battery: 'Batería',
    charging: 'Cargando',
    distance: 'Distancia a casa',
    accuracy: 'Precisión de la posición',
    at_home: 'En casa',
    online: 'Localizador en línea',
    power_saving: 'Ahorro de energía',
    activity: 'Actividad de hoy',
    rest: 'Descanso de hoy',
    activity_goal: 'Objetivo de actividad diario',
    live_tracking: 'Seguimiento en directo',
    buzzer: 'Zumbador',
    led: 'Luz (LED)',
  },
};

/** Connection statuses shown in the Configuration screen. */
export const CONNECTION_TEXT = {
  noCredentials: {
    en: 'Enter the e-mail address and the password of your Tractive account.',
    fr: "Saisissez l'adresse e-mail et le mot de passe de votre compte Tractive.",
    de: 'Gib die E-Mail-Adresse und das Passwort deines Tractive-Kontos ein.',
    es: 'Introduzca la dirección de correo y la contraseña de su cuenta Tractive.',
  },
  loginRefused: {
    en: 'Tractive refused the e-mail address or the password: check them, then save.',
    fr: "Tractive refuse l'adresse e-mail ou le mot de passe : vérifiez-les, puis enregistrez.",
    de: 'Tractive lehnt die E-Mail-Adresse oder das Passwort ab: Prüfe sie und speichere dann.',
    es: 'Tractive rechaza la dirección de correo o la contraseña: compruébelas y guarde.',
  },
  unreachable: {
    en: 'Tractive cannot be reached for now; the integration keeps trying.',
    fr: "Tractive est injoignable pour l'instant ; l'intégration réessaie.",
    de: 'Tractive ist gerade nicht erreichbar; die Integration versucht es weiter.',
    es: 'No se puede contactar con Tractive por ahora; la integración lo sigue intentando.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
};

/**
 * Messages of the code, one table per language: the "Test the connection"
 * report, the command errors (shown by Gladys when a command fails) and the
 * widget toasts. Functions take the values they show.
 */
export const MESSAGES = {
  en: {
    testOk: (count, names) => `Connected to Tractive: ${count} pet(s) with a tracker (${names}).`,
    testNoPets:
      'Connected to Tractive, but this account has no pet with a tracker (a tracker shared with you is not listed).',
    channelUp: 'Real-time updates: connected.',
    channelDown: 'Real-time updates: not connected, the states refresh every few minutes.',
    noHouse:
      'No Gladys house has a location: the distance and "at home" stay empty until you set one.',
    notConnected: 'The integration is not connected to Tractive yet.',
    unknownPet: 'This pet is unknown to Tractive (removed from the account?).',
    unsupported: 'This tracker does not have this function.',
    powerSaving:
      'The tracker is in power saving mode (home Wi-Fi zone): commands work again once it leaves the zone.',
    forbidden: 'Tractive refused: the subscription or this tracker does not allow this function.',
    failed: (reason) => `Tractive did not accept the command (${reason}).`,
    buzzerOn: (name) => `${name}'s tracker is buzzing.`,
    buzzerOff: (name) => `${name}'s buzzer is off.`,
    ledOn: (name) => `${name}'s light is on.`,
    ledOff: (name) => `${name}'s light is off.`,
  },
  fr: {
    testOk: (count, names) =>
      `Connecté à Tractive : ${count} animal(aux) avec un traceur (${names}).`,
    testNoPets:
      "Connecté à Tractive, mais ce compte n'a aucun animal avec un traceur (un traceur partagé avec vous n'est pas listé).",
    channelUp: 'Mises à jour en temps réel : connectées.',
    channelDown:
      'Mises à jour en temps réel : non connectées, les états se rafraîchissent toutes les quelques minutes.',
    noHouse:
      "Aucune maison de Gladys n'a de position : la distance et « à la maison » restent vides tant qu'il n'y en a pas.",
    notConnected: "L'intégration n'est pas encore connectée à Tractive.",
    unknownPet: 'Cet animal est inconnu de Tractive (retiré du compte ?).',
    unsupported: "Ce traceur n'a pas cette fonction.",
    powerSaving:
      "Le traceur est en économie d'énergie (zone Wi-Fi de la maison) : les commandes reviennent quand il en sort.",
    forbidden: "Tractive refuse : l'abonnement ou ce traceur ne permet pas cette fonction.",
    failed: (reason) => `Tractive n'a pas accepté la commande (${reason}).`,
    buzzerOn: (name) => `Le traceur de ${name} sonne.`,
    buzzerOff: (name) => `Le buzzer de ${name} est arrêté.`,
    ledOn: (name) => `La lumière de ${name} est allumée.`,
    ledOff: (name) => `La lumière de ${name} est éteinte.`,
  },
  de: {
    testOk: (count, names) => `Mit Tractive verbunden: ${count} Tier(e) mit Tracker (${names}).`,
    testNoPets:
      'Mit Tractive verbunden, aber dieses Konto hat kein Tier mit Tracker (ein mit dir geteilter Tracker wird nicht aufgeführt).',
    channelUp: 'Echtzeit-Aktualisierungen: verbunden.',
    channelDown:
      'Echtzeit-Aktualisierungen: nicht verbunden, die Zustände werden alle paar Minuten aktualisiert.',
    noHouse:
      'Kein Haus in Gladys hat einen Standort: Abstand und „Zu Hause“ bleiben leer, bis du einen festlegst.',
    notConnected: 'Die Integration ist noch nicht mit Tractive verbunden.',
    unknownPet: 'Dieses Tier ist bei Tractive unbekannt (aus dem Konto entfernt?).',
    unsupported: 'Dieser Tracker hat diese Funktion nicht.',
    powerSaving:
      'Der Tracker ist im Energiesparmodus (WLAN-Zone zu Hause): Die Befehle gehen wieder, sobald er die Zone verlässt.',
    forbidden: 'Tractive lehnt ab: Das Abo oder dieser Tracker erlaubt diese Funktion nicht.',
    failed: (reason) => `Tractive hat den Befehl nicht angenommen (${reason}).`,
    buzzerOn: (name) => `Der Tracker von ${name} summt.`,
    buzzerOff: (name) => `Der Summer von ${name} ist aus.`,
    ledOn: (name) => `Das Licht von ${name} ist an.`,
    ledOff: (name) => `Das Licht von ${name} ist aus.`,
  },
  es: {
    testOk: (count, names) =>
      `Conectado a Tractive: ${count} mascota(s) con localizador (${names}).`,
    testNoPets:
      'Conectado a Tractive, pero esta cuenta no tiene ninguna mascota con localizador (un localizador compartido con usted no aparece).',
    channelUp: 'Actualizaciones en tiempo real: conectadas.',
    channelDown:
      'Actualizaciones en tiempo real: no conectadas, los estados se actualizan cada pocos minutos.',
    noHouse:
      'Ninguna casa de Gladys tiene ubicación: la distancia y «en casa» quedan vacías hasta que defina una.',
    notConnected: 'La integración aún no está conectada a Tractive.',
    unknownPet: 'Tractive no conoce esta mascota (¿eliminada de la cuenta?).',
    unsupported: 'Este localizador no tiene esta función.',
    powerSaving:
      'El localizador está en ahorro de energía (zona wifi de casa): los comandos vuelven a funcionar cuando sale de la zona.',
    forbidden: 'Tractive lo rechaza: la suscripción o este localizador no permite esta función.',
    failed: (reason) => `Tractive no ha aceptado el comando (${reason}).`,
    buzzerOn: (name) => `El localizador de ${name} está sonando.`,
    buzzerOff: (name) => `El zumbador de ${name} está apagado.`,
    ledOn: (name) => `La luz de ${name} está encendida.`,
    ledOff: (name) => `La luz de ${name} está apagada.`,
  },
};

/** The table of one language, French when the language is unknown. */
export const messagesFor = (language) => MESSAGES[language] ?? MESSAGES.fr;

/** A multi-language object built from a key (and arguments) of MESSAGES. */
export function allLanguages(key, ...args) {
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const value = MESSAGES[language][key];
      return [language, typeof value === 'function' ? value(...args) : value];
    }),
  );
}
