/** The website's address: the phone app calls it only for actions that need the server's secret key (adding people). Overridable at build time. */
export const WEB = (process.env.EXPO_PUBLIC_WEB_URL ?? 'https://schoolskl.vercel.app').replace(/\/$/, '');
