// Sign-in and sign-up are one email-first flow on /login now; old links land there.
import { redirect } from "@sveltejs/kit";

export const load = ({ url }) => redirect(307, `/login${url.search}`);
