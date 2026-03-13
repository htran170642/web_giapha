"use client";

import PersonCard from "@/components/PersonCard";
import { Person, Relationship } from "@/types";
import { ArrowUpDown, Filter, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useDashboard } from "./DashboardContext";

export default function DashboardMemberList({
  initialPersons,
  initialRelationships = [],
  canEdit = false,
}: {
  initialPersons: Person[];
  initialRelationships?: Relationship[];
  canEdit?: boolean;
}) {
  const { setShowCreateMember } = useDashboard();
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState("generation_asc");

  const [filterOption, setFilterOption] = useState("all");

  const filteredPersons = useMemo(() => {
    return initialPersons.filter((person) => {
      const matchesSearch = person.full_name
        .toLowerCase()
        .includes(searchTerm.toLowerCase());

      let matchesFilter = true;
      switch (filterOption) {
        case "male":
          matchesFilter = person.gender === "male";
          break;
        case "female":
          matchesFilter = person.gender === "female";
          break;
        case "in_law_female":
          matchesFilter = person.gender === "female" && person.is_in_law;
          break;
        case "in_law_male":
          matchesFilter = person.gender === "male" && person.is_in_law;
          break;
        case "deceased":
          matchesFilter = person.is_deceased;
          break;
        case "first_child":
          matchesFilter = person.birth_order === 1;
          break;
        case "all":
        default:
          matchesFilter = true;
          break;
      }

      return matchesSearch && matchesFilter;
    });
  }, [initialPersons, searchTerm, filterOption]);

  // Build ordered generation groups: non-in-laws sorted by parent birth_order
  // then own birth_order; each in-law inserted right after their spouse.
  const generationGroups = useMemo(() => {
    if (!sortOption.includes("generation")) return [];

    const marriages = initialRelationships.filter((r) => r.type === "marriage");
    const parentChildRels = initialRelationships.filter(
      (r) => r.type === "biological_child" || r.type === "adopted_child",
    );

    // personsById covers ALL persons (not just filtered) for parent lookups
    const personsById = new Map(initialPersons.map((p) => [p.id, p]));

    // childParents: childId → parentId[]
    const childParents = new Map<string, string[]>();
    parentChildRels.forEach((r) => {
      if (!childParents.has(r.person_b)) childParents.set(r.person_b, []);
      childParents.get(r.person_b)!.push(r.person_a);
    });

    // Returns the full ancestry path as an array of birth_orders from root → self.
    // e.g. great-grandchild with order 2 whose grandfather had order 1 → [1, X, 2]
    const pathCache = new Map<string, number[]>();
    const getAncestryPath = (personId: string, visited = new Set<string>()): number[] => {
      if (pathCache.has(personId)) return pathCache.get(personId)!;
      if (visited.has(personId)) return [999];
      visited.add(personId);

      const person = personsById.get(personId);
      if (!person) return [999];

      const parentIds = childParents.get(personId) ?? [];
      const bloodParentId = parentIds.find((pid) => {
        const p = personsById.get(pid);
        return p && !p.is_in_law;
      });

      const ownOrder = person.birth_order ?? 999;
      const path = bloodParentId
        ? [...getAncestryPath(bloodParentId, visited), ownOrder]
        : [ownOrder];

      pathCache.set(personId, path);
      return path;
    };

    const compareAncestryPaths = (a: number[], b: number[]): number => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
      }
      return a.length - b.length;
    };

    // Group filtered persons by generation
    const byGen: Record<number, Person[]> = {};
    filteredPersons.forEach((p) => {
      const gen = p.generation ?? 0;
      if (!byGen[gen]) byGen[gen] = [];
      byGen[gen].push(p);
    });

    const sortedGens = Object.entries(byGen).sort(([a], [b]) =>
      sortOption === "generation_desc"
        ? Number(b) - Number(a)
        : Number(a) - Number(b),
    );

    return sortedGens.map(([gen, members]) => {
      const inLaws = members.filter((p) => p.is_in_law);
      const nonInLaws = members
        .filter((p) => !p.is_in_law)
        .sort((a, b) => compareAncestryPaths(getAncestryPath(a.id), getAncestryPath(b.id)));

      // Map each in-law to their spouse id (the non-in-law they're married to)
      const inLawById = new Map(inLaws.map((p) => [p.id, p]));
      const spouseOf = new Map<string, string>(); // inLawId → spouseId
      marriages.forEach((r) => {
        if (inLawById.has(r.person_a) && !inLawById.has(r.person_b)) {
          spouseOf.set(r.person_a, r.person_b);
        } else if (inLawById.has(r.person_b) && !inLawById.has(r.person_a)) {
          spouseOf.set(r.person_b, r.person_a);
        }
      });

      // Build spouse → in-laws list
      const spouseInLaws = new Map<string, Person[]>();
      inLaws.forEach((p) => {
        const sid = spouseOf.get(p.id);
        if (sid) {
          if (!spouseInLaws.has(sid)) spouseInLaws.set(sid, []);
          spouseInLaws.get(sid)!.push(p);
        }
      });

      // Interleave: non-in-law then their in-law spouse(s)
      const ordered: Person[] = [];
      const placedInLaws = new Set<string>();
      nonInLaws.forEach((p) => {
        ordered.push(p);
        (spouseInLaws.get(p.id) ?? []).forEach((inLaw) => {
          ordered.push(inLaw);
          placedInLaws.add(inLaw.id);
        });
      });
      // Append unmatched in-laws at the end
      inLaws.forEach((p) => {
        if (!placedInLaws.has(p.id)) ordered.push(p);
      });

      return { gen, persons: ordered };
    });
  }, [filteredPersons, initialPersons, initialRelationships, sortOption]);

  const sortedPersons = useMemo(() => {
    return [...filteredPersons].sort((a, b) => {
      switch (sortOption) {
        case "birth_asc":
          return (a.birth_year || 9999) - (b.birth_year || 9999);
        case "birth_desc":
          return (b.birth_year || 0) - (a.birth_year || 0);
        case "name_asc":
          return a.full_name.localeCompare(b.full_name, "vi");
        case "name_desc":
          return b.full_name.localeCompare(a.full_name, "vi");
        case "updated_desc":
          return (
            new Date(b.updated_at || 0).getTime() -
            new Date(a.updated_at || 0).getTime()
          );
        case "updated_asc":
          return (
            new Date(a.updated_at || 0).getTime() -
            new Date(b.updated_at || 0).getTime()
          );
        case "generation_asc":
          if (a.generation !== b.generation) {
            return (a.generation || 999) - (b.generation || 999);
          }
          return (a.birth_order || 999) - (b.birth_order || 999);
        case "generation_desc":
          if (b.generation !== a.generation) {
            return (b.generation || 0) - (a.generation || 0);
          }
          return (b.birth_order || 0) - (a.birth_order || 0);
        default:
          return 0;
      }
    });
  }, [filteredPersons, sortOption]);

  return (
    <>
      <div className="mb-8 relative">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/60 backdrop-blur-xl p-4 sm:p-5 rounded-2xl shadow-sm border border-stone-200/60 transition-all duration-300 relative z-10 w-full">
          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto flex-1">
            <div className="relative flex-1 max-w-sm group">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-stone-400 group-focus-within:text-amber-500 transition-colors" />
              <input
                type="text"
                placeholder="Tìm kiếm thành viên..."
                className="bg-white/90 text-stone-900 w-full pl-10 pr-4 py-2.5 rounded-xl border border-stone-200/80 shadow-sm placeholder-stone-400 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto items-center">
              <div className="relative w-full sm:w-auto">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-stone-400 pointer-events-none" />
                <select
                  className="appearance-none bg-white/90 text-stone-700 w-full sm:w-40 pl-9 pr-8 py-2.5 rounded-xl border border-stone-200/80 shadow-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 hover:border-amber-300 font-medium text-sm transition-all focus:bg-white"
                  value={filterOption}
                  onChange={(e) => setFilterOption(e.target.value)}
                >
                  <option value="all">Tất cả</option>
                  <option value="male">Nam</option>
                  <option value="female">Nữ</option>
                  <option value="in_law_female">Dâu</option>
                  <option value="in_law_male">Rể</option>
                  <option value="deceased">Đã mất</option>
                  <option value="first_child">Con trưởng</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                  <svg
                    className="size-4 text-stone-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M19 9l-7 7-7-7"
                    ></path>
                  </svg>
                </div>
              </div>

              <div className="relative w-full sm:w-auto">
                <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-stone-400 pointer-events-none" />
                <select
                  className="appearance-none bg-white/90 text-stone-700 w-full sm:w-52 pl-9 pr-8 py-2.5 rounded-xl border border-stone-200/80 shadow-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 hover:border-amber-300 font-medium text-sm transition-all focus:bg-white"
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value)}
                >
                  <option value="birth_asc">Năm sinh (Tăng dần)</option>
                  <option value="birth_desc">Năm sinh (Giảm dần)</option>
                  <option value="name_asc">Tên (A-Z)</option>
                  <option value="name_desc">Tên (Z-A)</option>
                  <option value="updated_desc">Cập nhật (Mới nhất)</option>
                  <option value="updated_asc">Cập nhật (Cũ nhất)</option>
                  <option value="generation_asc">Theo thế hệ (Tăng dần)</option>
                  <option value="generation_desc">
                    Theo thế hệ (Giảm dần)
                  </option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                  <svg
                    className="size-4 text-stone-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M19 9l-7 7-7-7"
                    ></path>
                  </svg>
                </div>
              </div>
            </div>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowCreateMember(true)}
              className="btn-primary"
            >
              <Plus className="size-4" strokeWidth={2.5} />
              Thêm thành viên
            </button>
          )}
        </div>
      </div>

      {filteredPersons.length > 0 ? (
        sortOption.includes("generation") ? (
          <div className="space-y-12">
            {generationGroups.map(({ gen, persons }) => (
                <div key={gen} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-stone-200"></div>
                    <h3 className="text-lg font-serif font-bold text-amber-800 bg-amber-50 px-4 py-1.5 rounded-full border border-amber-200/50 shadow-sm">
                      {gen === 0 ? "Chưa xác định đời" : `Đời thứ ${gen}`}
                    </h3>
                    <div className="h-px flex-1 bg-stone-200"></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {persons.map((person) => (
                      <PersonCard key={person.id} person={person} />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedPersons.map((person) => (
              <PersonCard key={person.id} person={person} />
            ))}
          </div>
        )
      ) : (
        <div className="text-center py-12 text-stone-400 italic">
          {initialPersons.length > 0
            ? "Không tìm thấy thành viên phù hợp."
            : "Chưa có thành viên nào. Hãy thêm thành viên đầu tiên."}
        </div>
      )}
    </>
  );
}
