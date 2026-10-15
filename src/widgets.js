// -----------------------------------------------------------------------------
// Dashboard widget "Tractive pet": where the pet is (distance from home, at
// home or not), its battery, its activity of the day, and two buttons to find
// it (buzzer, light). Content in the core vocabulary, pre-localized from the
// requesting user's language (the core caches it per language).
//
// The tiles are bound to the device features, so they follow the states live;
// the status rows and the buttons follow the nudges hub.js sends.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { deviceIds, featureKeys } from './devices.js';
import { allLanguages } from './i18n.js';
import { isOnline } from './tractive/status.js';
import { WIDGET_KEY } from './hub.js';

/** Texts of the widget, one table per language (labels ≤ 24, values ≤ 40). */
export const TEXT = {
  en: {
    pick: 'Choose a pet in the settings of this widget.',
    unknown: 'This pet is not known (yet): check the Tractive integration.',
    distance: 'Distance',
    battery: 'Battery',
    activity: 'Activity',
    atHome: 'At home',
    yes: 'Yes',
    no: 'No',
    unknownValue: 'Unknown',
    noHouse: 'No located house',
    position: 'Position',
    justNow: 'Just now',
    minutesAgo: (minutes) => `${minutes} min ago`,
    hoursAgo: (hours) => `${hours} h ago`,
    daysAgo: (days) => `${days} day(s) ago`,
    tracker: 'Tracker',
    online: 'Online',
    offline: 'Offline',
    powerSaving: 'Power saving (home Wi-Fi)',
    buzzer: 'Buzz',
    stopBuzzer: 'Stop buzzer',
    led: 'Light',
    stopLed: 'Light off',
  },
  fr: {
    pick: 'Choisissez un animal dans les réglages de ce widget.',
    unknown: "Cet animal n'est pas (encore) connu : vérifiez l'intégration Tractive.",
    distance: 'Distance',
    battery: 'Batterie',
    activity: 'Activité',
    atHome: 'À la maison',
    yes: 'Oui',
    no: 'Non',
    unknownValue: 'Inconnu',
    noHouse: 'Aucune maison située',
    position: 'Position',
    justNow: "À l'instant",
    minutesAgo: (minutes) => `Il y a ${minutes} min`,
    hoursAgo: (hours) => `Il y a ${hours} h`,
    daysAgo: (days) => `Il y a ${days} jour(s)`,
    tracker: 'Traceur',
    online: 'En ligne',
    offline: 'Hors ligne',
    powerSaving: 'Économie (Wi-Fi maison)',
    buzzer: 'Faire sonner',
    stopBuzzer: 'Arrêter le buzzer',
    led: 'Allumer la LED',
    stopLed: 'Éteindre la LED',
  },
  de: {
    pick: 'Wähle in den Einstellungen dieses Widgets ein Tier aus.',
    unknown: 'Dieses Tier ist (noch) nicht bekannt: Prüfe die Tractive-Integration.',
    distance: 'Abstand',
    battery: 'Batterie',
    activity: 'Aktivität',
    atHome: 'Zu Hause',
    yes: 'Ja',
    no: 'Nein',
    unknownValue: 'Unbekannt',
    noHouse: 'Kein Haus mit Standort',
    position: 'Position',
    justNow: 'Gerade eben',
    minutesAgo: (minutes) => `Vor ${minutes} Min.`,
    hoursAgo: (hours) => `Vor ${hours} Std.`,
    daysAgo: (days) => `Vor ${days} Tag(en)`,
    tracker: 'Tracker',
    online: 'Online',
    offline: 'Offline',
    powerSaving: 'Energiesparen (WLAN zu Hause)',
    buzzer: 'Summen',
    stopBuzzer: 'Summer aus',
    led: 'Licht an',
    stopLed: 'Licht aus',
  },
  es: {
    pick: 'Elija una mascota en los ajustes de este widget.',
    unknown: 'Esta mascota no se conoce (todavía): compruebe la integración Tractive.',
    distance: 'Distancia',
    battery: 'Batería',
    activity: 'Actividad',
    atHome: 'En casa',
    yes: 'Sí',
    no: 'No',
    unknownValue: 'Desconocido',
    noHouse: 'Ninguna casa ubicada',
    position: 'Posición',
    justNow: 'Ahora mismo',
    minutesAgo: (minutes) => `Hace ${minutes} min`,
    hoursAgo: (hours) => `Hace ${hours} h`,
    daysAgo: (days) => `Hace ${days} día(s)`,
    tracker: 'Localizador',
    online: 'En línea',
    offline: 'Sin conexión',
    powerSaving: 'Ahorro (wifi de casa)',
    buzzer: 'Hacer sonar',
    stopBuzzer: 'Parar zumbador',
    led: 'Encender luz',
    stopLed: 'Apagar luz',
  },
};

// Keys of the button actions (frozen once published).
export const ACTIONS = { BUZZER: 'buzzer', LED: 'led' };

const TTL_SECONDS = 300;

function age(text, positionTime, now) {
  const minutes = Math.max(0, Math.floor((now / 1000 - positionTime) / 60));
  if (minutes < 1) return text.justNow;
  if (minutes < 60) return text.minutesAgo(minutes);
  if (minutes < 48 * 60) return text.hoursAgo(Math.floor(minutes / 60));
  return text.daysAgo(Math.floor(minutes / 1440));
}

/** The widget content for one pet. */
export function buildWidgetContent(hub, { settings = {}, language } = {}) {
  const text = TEXT[language] ?? TEXT.en;
  const message = (body) => ({
    ttl_seconds: TTL_SECONDS,
    components: [{ type: 'text', variant: 'body', text: body }],
  });
  if (!settings.device) {
    return message(text.pick);
  }
  const pet = hub.petByDevice({ external_id: settings.device });
  if (!pet) {
    return message(text.unknown);
  }
  const ids = deviceIds(hub.gladys, pet.petId);
  const keys = new Set(featureKeys(pet));
  const presence = hub.presence.get(pet.petId) ?? { distance: null, atHome: null };
  const components = [
    { type: 'text', variant: 'heading', text: pet.name.slice(0, 40) },
    {
      type: 'value',
      label: text.distance,
      device_feature: ids.feature('distance'),
      icon: 'map-pin',
    },
    { type: 'value', label: text.battery, device_feature: ids.feature('battery'), icon: 'battery' },
  ];
  if (keys.has('activity')) {
    if (
      Number.isFinite(pet.activityGoal) &&
      pet.activityGoal > 0 &&
      Number.isFinite(pet.activityMinutes)
    ) {
      components.push({
        type: 'gauge',
        label: text.activity,
        value: pet.activityMinutes,
        min: 0,
        max: Math.max(pet.activityGoal, pet.activityMinutes),
        unit: 'min',
        color:
          pet.activityMinutes >= pet.activityGoal ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.PRIMARY,
      });
    } else {
      components.push({
        type: 'value',
        label: text.activity,
        device_feature: ids.feature('activity'),
        icon: 'activity',
      });
    }
  }

  const online = isOnline(pet);
  components.push({
    type: 'status',
    items: [
      {
        label: text.atHome,
        value: !hub.home
          ? text.noHouse
          : presence.atHome === null
            ? text.unknownValue
            : presence.atHome
              ? text.yes
              : text.no,
        icon: 'home',
        color:
          presence.atHome === null
            ? WIDGET_COLORS.NEUTRAL
            : presence.atHome
              ? WIDGET_COLORS.SUCCESS
              : WIDGET_COLORS.WARNING,
      },
      {
        label: text.position,
        value:
          pet.positionTime === null ? text.unknownValue : age(text, pet.positionTime, hub.now()),
        icon: 'clock',
        color: WIDGET_COLORS.NEUTRAL,
      },
      {
        label: text.tracker,
        value:
          online === null
            ? text.unknownValue
            : !online
              ? text.offline
              : pet.powerSaving
                ? text.powerSaving
                : text.online,
        icon: 'radio',
        color:
          online === null
            ? WIDGET_COLORS.NEUTRAL
            : online
              ? WIDGET_COLORS.SUCCESS
              : WIDGET_COLORS.DANGER,
      },
    ],
  });

  // A running function is shown by its icon, never by the button style: the
  // `primary` style does not show in dark mode (Gladys#3153).
  if (keys.has('buzzer')) {
    components.push({
      type: 'button',
      label: pet.buzzer ? text.stopBuzzer : text.buzzer,
      icon: pet.buzzer ? 'check-circle' : 'volume-2',
      style: 'secondary',
      action: { key: ACTIONS.BUZZER, params: { on: !pet.buzzer } },
    });
  }
  if (keys.has('led')) {
    components.push({
      type: 'button',
      label: pet.led ? text.stopLed : text.led,
      icon: pet.led ? 'check-circle' : 'sun',
      style: 'secondary',
      action: { key: ACTIONS.LED, params: { on: !pet.led } },
    });
  }
  return { ttl_seconds: TTL_SECONDS, components };
}

/** A tapped button: buzzer or light of the widget's pet. */
export async function widgetAction(hub, { actionKey, params = {}, settings = {} }) {
  const pet = hub.petByDevice({ external_id: settings.device });
  if (!pet) {
    return allLanguages('unknownPet');
  }
  const key = actionKey === ACTIONS.BUZZER ? 'buzzer' : actionKey === ACTIONS.LED ? 'led' : null;
  if (!key) {
    return undefined;
  }
  const on = params.on !== false;
  await hub.command(pet, key, on);
  return allLanguages(`${key}${on ? 'On' : 'Off'}`, pet.name);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get: buildWidgetContent, action: widgetAction },
};
