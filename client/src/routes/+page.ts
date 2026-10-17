import { redirect } from "@sveltejs/kit";

/** AME has no front page: the root goes straight to the experimenter login. */
export function load(): never {
  redirect(307, "/admin/login");
}
