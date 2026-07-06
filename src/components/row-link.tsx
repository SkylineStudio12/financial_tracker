"use client";

import { useRouter } from "next/navigation";

/** Table row that navigates on click/Enter. Presentation-only wrapper. */
export function RowLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <tr
      className={`outline-none focus-visible:ring-3 focus-visible:ring-focus-ring ${className ?? ""}`}
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter") router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
