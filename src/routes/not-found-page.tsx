import { Link } from "react-router-dom";
import { Compass, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center">
      <Compass className="h-14 w-14 text-muted-foreground" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">404</h1>
        <p className="text-sm text-muted-foreground">这个页面不存在</p>
      </div>
      <Button asChild variant="ghost" size="sm">
        <Link to="/">
          <Home className="h-4 w-4" />
          回到首页
        </Link>
      </Button>
    </div>
  );
}
