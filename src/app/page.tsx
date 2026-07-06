import { redirect } from "next/navigation";

export default function Home() {
  // Land on the shared consolidated view; the switcher takes it from there.
  redirect("/p/household/transactions");
}
