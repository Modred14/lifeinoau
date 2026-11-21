// components/CampusPopulation.js
// The campus population in the header: "6,248 people on campus". The number is the server's (lib/campusPopulation.js explains how it is made up); nothing is
// shown until the server has said, and it changes whenever a player's entry is counted (pushed over the realtime connection, otherwise fetched every two minutes).
"use client";
import { Icon } from "./Icon";
import { usePopulation } from "@/lib/populationClient";
import { formatCount, formatPeople } from "@/lib/campusPopulation.js";

export default function CampusPopulation() {
  const people = usePopulation();
  if (people == null) return null;
  return (
    <span className="pop num" title={formatPeople(people)}>
      <Icon name="users" size={15} weight="fill" />
      <span className="pop-v" key={people}>{formatCount(people)}</span>
      <span className="pop-t"> people on campus</span>
    </span>
  );
}
