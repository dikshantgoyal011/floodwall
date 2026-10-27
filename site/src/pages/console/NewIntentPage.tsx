import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ConsoleBackLink } from "../../components/console/ConsoleBackLink";
import { ConsoleButton } from "../../components/console/ConsoleButton";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsoleSelect } from "../../components/console/ConsoleSelect";
import { Card, CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { ACTION_KINDS, BLAST_RADII, CONSOLE_PATHS, PRIORITIES } from "../../constants/console";
import { MOCK_AGENTS } from "../../constants/console-mock";
import { parseReplicas } from "../../helpers/gate";
import { usePlane } from "../../hooks/usePlane";
import type { ActionKind, BlastRadius, Priority } from "../../types/console";
import { cx } from "../../helpers/cx";
import { consoleActions, consoleField, consoleLabel } from "../../styles/classes";

export function NewIntentPage() {
  const { submit } = usePlane();
  const navigate = useNavigate();
  const [agent, setAgent] = useState(MOCK_AGENTS[0]);
  const [kind, setKind] = useState<ActionKind>("scale");
  const [resource, setResource] = useState("web");
  const [detail, setDetail] = useState("3");
  const [priority, setPriority] = useState<Priority>("normal");
  const [blast, setBlast] = useState<BlastRadius>("service");

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    // The browser already blocks this through min, step and required; this
    // keeps a fraction or a negative out of the queue if it gets past them.
    const replicas = kind === "scale" ? parseReplicas(detail) : null;
    if (kind === "scale" && replicas === null) return;
    const id = submit({
      agent,
      action: { kind, resource: resource.trim(), detail: kind === "destroy" ? undefined : (replicas ?? detail.trim()) },
      priority,
      blast,
    });
    navigate(CONSOLE_PATHS.intent(id));
  };

  return (
    <>
      <ConsoleBackLink to={CONSOLE_PATHS.intents}>Intents</ConsoleBackLink>
      <ConsolePageHeader title="Submit intent" description="Propose a change as an agent would. It joins the queue." />

      <Card className="max-w-160 py-7">
        <CardContent className="px-7">
          <form className="flex flex-col gap-5" onSubmit={onSubmit}>
            <ConsoleSelect label="Agent" value={agent} options={MOCK_AGENTS} onChange={setAgent} />

            <div className="flex flex-wrap gap-4 *:min-w-40">
              <ConsoleSelect label="Action" value={kind} options={ACTION_KINDS} onChange={setKind} />
              <div className={consoleField}>
                <Label className={consoleLabel} htmlFor="intent-resource">
                  Resource
                </Label>
                <Input id="intent-resource" value={resource} onChange={(e) => setResource(e.target.value)} required />
              </div>
              {kind !== "destroy" && (
                <div className={consoleField}>
                  <Label className={consoleLabel} htmlFor="intent-detail">
                    {kind === "scale" ? "Replicas" : "Manifest"}
                  </Label>
                  {kind === "scale" ? (
                    <Input
                      id="intent-detail"
                      key="replicas"
                      type="number"
                      min={0}
                      step={1}
                      value={detail}
                      onChange={(e) => setDetail(e.target.value)}
                      required
                    />
                  ) : (
                    <Input
                      id="intent-detail"
                      key="manifest"
                      value={detail}
                      onChange={(e) => setDetail(e.target.value)}
                      required
                    />
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-4 *:min-w-40">
              <ConsoleSelect label="Priority" value={priority} options={PRIORITIES} onChange={setPriority} />
              <ConsoleSelect label="Blast radius" value={blast} options={BLAST_RADII} onChange={setBlast} />
            </div>

            <div className={cx(consoleActions, "justify-end pt-1")}>
              <ConsoleButton variant="secondary" to={CONSOLE_PATHS.intents}>
                Cancel
              </ConsoleButton>
              <ConsoleButton type="submit">Submit to the queue</ConsoleButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
